import type { ConsoleChunk, JudgeCase, JudgeRunResult, SerializedError, WorkerResponse } from './types'

/** The worker surface the session transport needs; satisfied by a real module Worker. */
export interface WorkerLike {
  send(message: unknown): void
  terminate(): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}

/** Creates the workers a session runs on; injectable for tests and custom hosting. */
export type WorkerFactory = (url: string) => WorkerLike

/** Options for {@link createRunesm}. */
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

/** Handlers for a single judge run. */
export interface JudgeRunHandlers {
  /** Console chunks as they stream in, before the final result. */
  readonly onConsoleChunk?: (chunk: ConsoleChunk) => void
}

/** A main-thread runesm session owning one module worker at a time. */
export interface RunesmSession {
  /** Runs user code as a judged module. Runs are serialized per session. */
  runJudge(code: string, cases: readonly JudgeCase[], handlers?: JudgeRunHandlers): Promise<JudgeRunResult>
  /** Terminates the worker and invalidates the session. */
  close(): void
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Creates a judge/REPL session backed by a dedicated module worker. Console
 * output streams through `onConsoleChunk` while the run executes; a run that
 * exceeds `timeoutMs` terminates the worker and resolves to a timeout error
 * result (the next run starts a fresh worker).
 */
export function createRunesm(options: RunesmOptions = {}): RunesmSession {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const workerFactory = options.workerFactory ?? defaultWorkerFactory
  const workerUrl =
    options.workerUrl !== undefined ? String(options.workerUrl) : new URL('worker-entry.mjs', import.meta.url).href

  let worker: WorkerLike | null = null
  let closed = false
  let nextRequestId = 1
  let queue: Promise<unknown> = Promise.resolve()

  const runJudge = (
    code: string,
    cases: readonly JudgeCase[],
    handlers?: JudgeRunHandlers,
  ): Promise<JudgeRunResult> => {
    if (closed) {
      return Promise.reject(new Error('runesm session is closed'))
    }
    const run = queue.then(
      () => dispatchJudge(code, cases, handlers),
      () => dispatchJudge(code, cases, handlers),
    )
    queue = run.catch(() => undefined)
    return run
  }

  const dispatchJudge = (
    code: string,
    cases: readonly JudgeCase[],
    handlers: JudgeRunHandlers | undefined,
  ): Promise<JudgeRunResult> =>
    new Promise<JudgeRunResult>((resolve) => {
      const sessionWorker = ensureWorker()
      if (sessionWorker === null) {
        resolve(closedResult('the session was closed before the run started'))
        return
      }

      const id = nextRequestId
      nextRequestId += 1
      let settled = false
      const pendingChunks: ConsoleChunk[] = []

      const finish = (result: JudgeRunResult): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        sessionWorker.removeEventListener('message', onMessage)
        sessionWorker.removeEventListener('error', onError)
        resolve(result)
      }

      const timer = setTimeout(() => {
        sessionWorker.removeEventListener('message', onMessage)
        sessionWorker.removeEventListener('error', onError)
        terminateWorker()
        finish(timeoutResult(timeoutMs, pendingChunks))
      }, timeoutMs)

      const onMessage = (event: unknown): void => {
        const response = (event as MessageEvent<WorkerResponse>).data
        if (response?.id !== id) {
          return
        }
        if (response.kind === 'console') {
          pendingChunks.push(response.chunk)
          handlers?.onConsoleChunk?.(response.chunk)
          return
        }
        finish(response.result)
      }

      const onError = (event: unknown): void => {
        const message = (event as ErrorEvent).message
        terminateWorker()
        finish(errorResult(`the worker failed to load or crashed: ${message}`, pendingChunks))
      }

      sessionWorker.addEventListener('message', onMessage)
      sessionWorker.addEventListener('error', onError)
      sessionWorker.send({
        kind: 'judge',
        id,
        code,
        cases,
        ...(options.deps === undefined ? {} : { deps: options.deps }),
        ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
      })
    })

  const ensureWorker = (): WorkerLike | null => {
    if (worker === null && !closed) {
      const created = workerFactory(workerUrl)
      created.addEventListener('messageerror', () => {
        terminateWorker()
      })
      worker = created
    }
    return worker
  }

  const terminateWorker = (): void => {
    if (worker !== null) {
      const current = worker
      worker = null
      current.terminate()
    }
  }

  return {
    runJudge,
    close(): void {
      closed = true
      terminateWorker()
    },
  }
}

const defaultWorkerFactory = (url: string): WorkerLike => {
  const worker = new Worker(url, { type: 'module' })
  const postToWorker = worker.postMessage.bind(worker)
  return {
    send: (message: unknown) => postToWorker(message),
    terminate: () => worker.terminate(),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      worker.addEventListener(type, listener as EventListener)
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      worker.removeEventListener(type, listener as EventListener)
    },
  }
}

const timeoutResult = (timeoutMs: number, console: ConsoleChunk[]): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console,
  error: {
    name: 'TimeoutError',
    message: `execution timed out after ${timeoutMs}ms and was terminated`,
  },
  dependencies: [],
  durationMs: timeoutMs,
})

const errorResult = (message: string, console: ConsoleChunk[]): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console,
  error: serializeMessage(message),
  dependencies: [],
  durationMs: 0,
})

const closedResult = (message: string): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console: [],
  error: serializeMessage(message),
  dependencies: [],
  durationMs: 0,
})

const serializeMessage = (message: string): SerializedError => ({
  name: 'RunesmError',
  message,
})
