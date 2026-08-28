import type { ConsoleChunk, JudgeCase, JudgeRunResult, ReplResult, SerializedError, WorkerResponse } from './types'
import type { TestRun, TestRunResult } from './test-types'

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

/** Options for lazy Vitest/Jest workspace runs. */
export interface TestSessionOptions extends RunesmOptions {
  /**
   * Hard timeout per run in milliseconds (default 60000 for test sessions).
   * The budget covers the engine download from esm.sh and the test run itself,
   * so keep it well above the judge default.
   */
  readonly timeoutMs?: number
  /**
   * Same-origin module service worker. Defaults to
   * `module-service-worker.mjs` next to the main runesm module.
   */
  readonly serviceWorkerUrl?: string | URL
}

/** A test-workspace session; each run receives a fresh execution worker. */
export interface TestSession {
  /** Runs canonical ESM modules with the selected official upstream engine. */
  run(run: TestRun, handlers?: ConsoleStreamHandlers): Promise<TestRunResult>
  /** Prevents future runs. An in-flight run still settles normally. */
  close(): void
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Test runs download the engine from esm.sh inside the same timed request as
 * the user's tests, so the judge/REPL default would report a cold download
 * as a user timeout.
 */
const DEFAULT_TEST_TIMEOUT_MS = 60_000

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

/**
 * Creates a lazy browser test session. Test engines are downloaded only when
 * `run` is called. Every call uses a fresh worker because Vitest and Jest keep
 * process-wide registration state.
 */
export function createTestSession(options: TestSessionOptions = {}): TestSession {
  let closed = false

  return {
    async run(run, handlers): Promise<TestRunResult> {
      if (closed) {
        throw new Error('runesm test session is closed')
      }
      const graphId = createGraphId()
      const startedAt = performance.now()
      let transport: WorkerTransport | undefined
      try {
        const serviceWorkerScope = await prepareModuleServiceWorker(options)
        const testWorkerUrl = resolveTestWorkerUrl(options)
        assertWorkerWithinScope(testWorkerUrl, serviceWorkerScope)
        transport = new WorkerTransport({
          ...options,
          timeoutMs: options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
          workerUrl: testWorkerUrl,
        })
        const outcome = await transport.request(
          {
            kind: 'test',
            run,
            graphId,
            serviceWorkerScope,
            ...(options.deps === undefined ? {} : { deps: options.deps }),
            ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
          },
          'test-result',
          handlers,
        )
        return asTestResult(outcome, transport.timeoutMs)
      } catch (error) {
        return {
          status: 'error',
          ok: false,
          tests: [],
          console: [],
          dependencies: [],
          error: serializedMainError(error),
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }
      } finally {
        transport?.close()
        await deleteTestGraphCache(graphId)
      }
    },
    close(): void {
      closed = true
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
  resultKind: 'result' | 'repl-result' | 'repl-ack' | 'test-result'
  handlers: ConsoleStreamHandlers | undefined
  pendingChunks: ConsoleChunk[]
  settled: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  worker: WorkerLike
  /** Settles this request exactly once: clears the timer, detaches the
   * worker listeners, and resolves the caller's promise with `outcome`.
   * Reassigned by `dispatch` once the worker listeners exist; callable from
   * `close()` and the `messageerror` listener so a terminated worker still
   * settles whichever request was in flight. */
  finish: (outcome: TransportOutcome) => void
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
  /** The one request currently in flight, if any (requests are serialized). */
  private pending: PendingRequest | null = null

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
    const active = this.pending
    if (active !== null) {
      active.finish({
        kind: 'worker-error',
        message: 'the session was closed while this run was still in progress',
        console: active.pendingChunks,
      })
    }
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
        finish: () => {},
      }

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
            response.kind === 'result' || response.kind === 'repl-result' || response.kind === 'test-result'
              ? response.result
              : undefined
          pending.finish({ kind: 'delivered', payload, console: pending.pendingChunks })
          return
        }
        // A response for this id whose kind neither is 'console' nor matches
        // what this request expects (for example a worker bundle from a
        // different cache generation replying with a kind this main-thread
        // bundle doesn't recognize as the pairing). Settle promptly instead
        // of leaving the caller to time out.
        pending.finish({
          kind: 'worker-error',
          message: `worker responded with unexpected message kind '${String(response.kind)}' for this request`,
          console: pending.pendingChunks,
        })
      }

      const onError = (event: unknown): void => {
        const failure = (event as ErrorEvent).message
        this.terminateWorker()
        pending.finish({ kind: 'worker-error', message: String(failure), console: pending.pendingChunks })
      }

      pending.finish = (outcome: TransportOutcome): void => {
        if (pending.settled) {
          return
        }
        pending.settled = true
        clearTimeout(pending.timer)
        sessionWorker.removeEventListener('message', onMessage)
        sessionWorker.removeEventListener('error', onError)
        if (this.pending === pending) {
          this.pending = null
        }
        pending.settle(outcome)
      }

      this.pending = pending

      pending.timer = setTimeout(() => {
        this.terminateWorker()
        pending.finish({ kind: 'timeout', console: pending.pendingChunks })
      }, this.timeoutMs)

      sessionWorker.addEventListener('message', onMessage)
      sessionWorker.addEventListener('error', onError)
      sessionWorker.send({ ...message, id })
    })
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker === null && !this.closed) {
      const created = this.workerFactory(this.workerUrl)
      const onMessageError = (): void => {
        created.removeEventListener('messageerror', onMessageError)
        const active = this.pending
        this.terminateWorker()
        if (active !== null) {
          active.finish({
            kind: 'worker-error',
            message: 'the worker sent a message the main thread could not decode (messageerror)',
            console: active.pendingChunks,
          })
        }
      }
      created.addEventListener('messageerror', onMessageError)
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

const asTestResult = (outcome: TransportOutcome, timeoutMs: number): TestRunResult => {
  if (outcome.kind === 'delivered') {
    return outcome.payload as TestRunResult
  }
  if (outcome.kind === 'timeout') {
    return {
      status: 'error',
      ok: false,
      tests: [],
      console: outcome.console,
      dependencies: [],
      error: timeoutError(timeoutMs),
      durationMs: timeoutMs,
    }
  }
  return {
    status: 'error',
    ok: false,
    tests: [],
    console: outcome.console,
    dependencies: [],
    error: workerError(outcome.message),
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

const prepareModuleServiceWorker = async (options: TestSessionOptions): Promise<string> => {
  if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) {
    throw new Error('test workspaces require Service Worker support in a secure browser context')
  }
  const serviceWorkerUrl =
    options.serviceWorkerUrl === undefined
      ? new URL(/* @vite-ignore */ 'module-service-worker.mjs', import.meta.url)
      : new URL(String(options.serviceWorkerUrl), globalThis.location?.href)
  if (serviceWorkerUrl.origin !== globalThis.location?.origin) {
    throw new Error('the test-workspace module service worker must be served from the website origin')
  }
  const scope = new URL('./', serviceWorkerUrl).href
  const registration = await navigator.serviceWorker.register(serviceWorkerUrl, { type: 'module', scope })
  await waitForActiveWorker(registration)
  return registration.scope
}

const waitForActiveWorker = async (registration: ServiceWorkerRegistration): Promise<void> => {
  if (registration.active !== null) {
    return
  }
  const worker = registration.installing ?? registration.waiting
  if (worker === null) {
    throw new Error('the test-workspace module service worker did not start installing')
  }
  await new Promise<void>((resolve, reject) => {
    const onStateChange = (): void => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onStateChange)
        resolve()
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', onStateChange)
        reject(new Error('the test-workspace module service worker became redundant during installation'))
      }
    }
    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
}

const resolveTestWorkerUrl = (options: TestSessionOptions): URL =>
  options.workerUrl === undefined
    ? new URL(/* @vite-ignore */ 'test-worker-entry.mjs', import.meta.url)
    : new URL(String(options.workerUrl), globalThis.location?.href)

const assertWorkerWithinScope = (workerUrl: URL, scope: string): void => {
  if (!workerUrl.href.startsWith(scope)) {
    throw new Error(
      `the test execution worker must be served under the module service-worker scope '${scope}', but resolved to '${workerUrl.href}'`,
    )
  }
}

const createGraphId = (): string => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const deleteTestGraphCache = async (graphId: string): Promise<void> => {
  if (typeof caches !== 'undefined') {
    await caches.delete(`runesm:test-graph:v1:${graphId}`)
  }
}

const serializedMainError = (error: unknown): SerializedError =>
  error instanceof Error
    ? { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
    : { name: 'NonError', message: String(error) }
