import type { ConsoleChunk, JudgeCase, JudgeRunResult, ReplResult, SerializedError, WorkerResponse } from './types'

/** The worker surface the session transport needs; satisfied by a real module Worker. */
export interface WorkerLike {
  send(message: unknown): void
  terminate(): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}

/** Creates the workers a session runs on; injectable for tests and custom hosting. */
export type WorkerFactory = (url: string) => WorkerLike

/** Options shared by every runesm session. */
export interface RunesmOptions {
  /** Package name to pinned version for bare-import resolution. */
  readonly deps?: Readonly<Record<string, string>>
  /** Resolve unpinned bare imports to the CDN's latest (default `true`). */
  readonly autoInstall?: boolean
  /** Hard timeout per run in milliseconds (default 5000); timing out terminates the worker. */
  readonly timeoutMs?: number
  /**
   * URL of the worker entry script. Defaults to the `worker-entry.mjs`
   * shipped next to the main-thread module; bundlers that relocate assets
   * should pass an explicit URL.
   */
  readonly workerUrl?: string | URL
  /** Builds the workers; tests inject fakes here. */
  readonly workerFactory?: WorkerFactory
}

/** Handlers for streamed console output during a run. */
export interface ConsoleStreamHandlers {
  /** Console chunks as they stream in, before the final result. */
  readonly onConsoleChunk?: (chunk: ConsoleChunk) => void
}

/** A main-thread judge session owning one module worker at a time. */
export interface RunesmSession {
  /** Runs user code as a judged module. Runs are serialized per session. */
  runJudge(code: string, cases: readonly JudgeCase[], handlers?: ConsoleStreamHandlers): Promise<JudgeRunResult>
  /** Terminates the worker and invalidates the session. */
  close(): void
}

/** A main-thread REPL session over the same worker transport. */
export interface ReplSession {
  /** Evaluates one input against the persistent session scope. */
  evaluate(input: string, handlers?: ConsoleStreamHandlers): Promise<ReplResult>
  /** Starts a fresh scope; later evaluations do not see earlier state. */
  reset(): Promise<void>
  /** Terminates the worker and invalidates the session. */
  close(): void
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Creates a judge session backed by a dedicated module worker. Console
 * output streams through `onConsoleChunk` while the run executes; a run that
 * exceeds `timeoutMs` terminates the worker and resolves to a timeout error
 * result (the next run starts a fresh worker).
 */
export function createRunesm(options: RunesmOptions = {}): RunesmSession {
  const transport = new WorkerTransport(options)

  return {
    runJudge(code, cases, handlers) {
      if (transport.isClosed) {
        return Promise.reject(new Error('runesm session is closed'))
      }
      return transport
        .request(
          {
            kind: 'judge',
            code,
            cases,
            ...(options.deps === undefined ? {} : { deps: options.deps }),
            ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
          },
          'result',
          handlers,
        )
        .then((outcome) => asJudgeResult(outcome, transport.timeoutMs))
    },
    close(): void {
      transport.close()
    },
  }
}

/**
 * Creates a REPL session backed by a dedicated module worker. Declarations,
 * imports, and reassignments persist across `evaluate` calls; `reset()`
 * starts a fresh scope. A hung evaluation terminates the worker — the next
 * evaluation starts fresh (state does not survive a timeout).
 */
export function createReplSession(options: RunesmOptions = {}): ReplSession {
  const transport = new WorkerTransport(options)
  let closed = false

  return {
    evaluate(input, handlers) {
      if (closed) {
        return Promise.reject(new Error('runesm session is closed'))
      }
      return transport
        .request(
          {
            kind: 'repl-input',
            input,
            ...(options.deps === undefined ? {} : { deps: options.deps }),
            ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
          },
          'repl-result',
          handlers,
        )
        .then((outcome) => asReplResult(outcome, transport.timeoutMs))
    },
    reset(): Promise<void> {
      if (closed) {
        return Promise.reject(new Error('runesm session is closed'))
      }
      return transport.request({ kind: 'repl-reset' }, 'repl-ack').then(() => undefined)
    },
    close(): void {
      closed = true
      transport.close()
    },
  }
}

/** What a transport request resolved to. */
type TransportOutcome =
  | { kind: 'delivered'; payload: unknown; console: ConsoleChunk[] }
  | { kind: 'timeout'; console: ConsoleChunk[] }
  | { kind: 'worker-error'; message: string; console: ConsoleChunk[] }

interface PendingRequest {
  settle: (outcome: TransportOutcome) => void
  resultKind: 'result' | 'repl-result' | 'repl-ack'
  handlers: ConsoleStreamHandlers | undefined
  pendingChunks: ConsoleChunk[]
  settled: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  worker: WorkerLike
}

/**
 * Owns the pairing, streaming, timeout, and lifecycle logic shared by judge
 * and REPL sessions. One request is in flight at a time; requests queue.
 */
class WorkerTransport {
  readonly timeoutMs: number

  private readonly workerFactory: WorkerFactory
  private readonly workerUrl: string
  private worker: WorkerLike | null = null
  private closed = false
  private nextRequestId = 1
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: RunesmOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory
    this.workerUrl =
      options.workerUrl !== undefined
        ? String(options.workerUrl)
        : // Bundlers try to resolve this at build time; the default only
          // matters when the build output is served as-is (next to
          // worker-entry.mjs), so it must stay a runtime resolution.
          new URL(/* @vite-ignore */ 'worker-entry.mjs', import.meta.url).href
  }

  request(
    message: Omit<WorkerRequestShape, 'id'>,
    resultKind: PendingRequest['resultKind'],
    handlers?: ConsoleStreamHandlers,
  ): Promise<TransportOutcome> {
    const run = this.queue.then(
      () => this.dispatch(message, resultKind, handlers),
      () => this.dispatch(message, resultKind, handlers),
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  close(): void {
    this.closed = true
    this.terminateWorker()
  }

  get isClosed(): boolean {
    return this.closed
  }

  private dispatch(
    message: Omit<WorkerRequestShape, 'id'>,
    resultKind: PendingRequest['resultKind'],
    handlers: ConsoleStreamHandlers | undefined,
  ): Promise<TransportOutcome> {
    return new Promise<TransportOutcome>((resolve) => {
      const sessionWorker = this.ensureWorker()
      if (sessionWorker === null) {
        resolve({
          kind: 'worker-error',
          message: 'the session was closed before the run started',
          console: [],
        })
        return
      }

      const id = this.nextRequestId
      this.nextRequestId += 1

      const pending: PendingRequest = {
        settle: resolve,
        resultKind,
        handlers,
        pendingChunks: [],
        settled: false,
        timer: undefined,
        worker: sessionWorker,
      }

      pending.timer = setTimeout(() => {
        this.terminateWorker()
        finish(pending, { kind: 'timeout', console: pending.pendingChunks })
      }, this.timeoutMs)

      const onMessage = (event: unknown): void => {
        const response = (event as MessageEvent<WorkerResponse>).data
        if (response?.id !== id) {
          return
        }
        if (response.kind === 'console') {
          pending.pendingChunks.push(response.chunk)
          handlers?.onConsoleChunk?.(response.chunk)
          return
        }
        if (response.kind === resultKind) {
          const payload =
            response.kind === 'result' ? response.result : response.kind === 'repl-result' ? response.result : undefined
          finish(pending, { kind: 'delivered', payload, console: pending.pendingChunks })
        }
      }

      const onError = (event: unknown): void => {
        const failure = (event as ErrorEvent).message
        this.terminateWorker()
        finish(pending, { kind: 'worker-error', message: String(failure), console: pending.pendingChunks })
      }

      const finish = (request: PendingRequest, outcome: TransportOutcome): void => {
        if (request.settled) {
          return
        }
        request.settled = true
        clearTimeout(request.timer)
        sessionWorker.removeEventListener('message', onMessage)
        sessionWorker.removeEventListener('error', onError)
        request.settle(outcome)
      }

      sessionWorker.addEventListener('message', onMessage)
      sessionWorker.addEventListener('error', onError)
      sessionWorker.send({ ...message, id })
    })
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker === null && !this.closed) {
      const created = this.workerFactory(this.workerUrl)
      created.addEventListener('messageerror', () => {
        this.terminateWorker()
      })
      this.worker = created
    }
    return this.worker
  }

  private terminateWorker(): void {
    if (this.worker !== null) {
      const current = this.worker
      this.worker = null
      current.terminate()
    }
  }
}

interface WorkerRequestShape {
  kind: string
  id: number
  [extra: string]: unknown
}

const defaultWorkerFactory = (url: string): WorkerLike => {
  const worker = new Worker(url, { type: 'module' })
  return adaptWorker(worker)
}

/**
 * Adapts a real Worker (for example one built by a bundler's `?worker`
 * import) to the surface the session transport expects.
 */
export function adaptWorker(worker: Worker): WorkerLike {
  const postToWorker = worker.postMessage.bind(worker)
  return {
    send: (message: unknown) => {
      postToWorker(message)
    },
    terminate: () => {
      worker.terminate()
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      worker.addEventListener(type, listener as EventListener)
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      worker.removeEventListener(type, listener as EventListener)
    },
  }
}

const asJudgeResult = (outcome: TransportOutcome, timeoutMs: number): JudgeRunResult => {
  if (outcome.kind === 'delivered') {
    return outcome.payload as JudgeRunResult
  }
  if (outcome.kind === 'timeout') {
    return timeoutResult(timeoutMs, outcome.console)
  }
  return workerErrorResult(outcome.message, outcome.console)
}

const asReplResult = (outcome: TransportOutcome, timeoutMs: number): ReplResult => {
  if (outcome.kind === 'delivered') {
    return outcome.payload as ReplResult
  }
  if (outcome.kind === 'timeout') {
    return {
      ok: false,
      error: timeoutError(timeoutMs),
      console: outcome.console,
      dependencies: [],
      durationMs: timeoutMs,
    }
  }
  return {
    ok: false,
    error: workerError(outcome.message),
    console: outcome.console,
    dependencies: [],
    durationMs: 0,
  }
}

const timeoutResult = (timeoutMs: number, console: ConsoleChunk[]): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console,
  error: timeoutError(timeoutMs),
  dependencies: [],
  durationMs: timeoutMs,
})

const workerErrorResult = (message: string, console: ConsoleChunk[]): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console,
  error: workerError(message),
  dependencies: [],
  durationMs: 0,
})

const timeoutError = (timeoutMs: number): SerializedError => ({
  name: 'TimeoutError',
  message: `execution timed out after ${timeoutMs}ms and was terminated`,
})

const workerError = (message: string): SerializedError => ({
  name: 'RunesmError',
  message,
})
