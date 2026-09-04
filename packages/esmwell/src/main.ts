import type { ConsoleChunk, JudgeCase, JudgeRunResult, ReplResult, SerializedError, WorkerResponse } from './types'
import type { ModuleProject, ModuleProjectModules, ModuleProjectResult } from './module-project'
import type { TestModules, TestRun, TestRunResult } from './test-types'
import type { SourceTransform, SourceTransformContext } from './transform'
import { adaptWorker, type WorkerLike } from './worker-like'

export { adaptWorker }
export type { WorkerLike }

/** Creates the workers a session runs on; injectable for tests and custom hosting. */
export type WorkerFactory = (url: string) => WorkerLike

/** Options shared by every esmwell session. */
export interface EsmwellOptions {
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
  /**
   * Same-origin child worker that owns submitted code. Defaults to the
   * execution entry shipped beside the package. Bundlers that relocate worker
   * assets must pass the emitted child-worker URL explicitly.
   */
  readonly executionWorkerUrl?: string | URL
  /** Builds the workers; tests inject fakes here. */
  readonly workerFactory?: WorkerFactory
  /**
   * Rewrites submitted source on the main thread before it reaches the
   * worker: judge modules, every REPL input, and each test-workspace module.
   * Use it to compile TypeScript or JSX into the ESM the runner executes.
   * Transforms run in submission order, so a slow one delays later inputs
   * rather than reordering them. A failure becomes an error result.
   */
  readonly transform?: SourceTransform
}

/** Handlers for streamed console output during a run. */
export interface ConsoleStreamHandlers {
  /** Console chunks as they stream in, before the final result. */
  readonly onConsoleChunk?: (chunk: ConsoleChunk) => void
}

/** A main-thread judge session backed by a coordinator and disposable execution workers. */
export interface EsmwellSession {
  /** Runs user code as a judged module. Runs are serialized per session. */
  runJudge(code: string, cases: readonly JudgeCase[], handlers?: ConsoleStreamHandlers): Promise<JudgeRunResult>
  /** Terminates the worker and invalidates the session. */
  close(): void
}

/** A main-thread REPL session backed by a coordinator and one stateful execution worker. */
export interface ReplSession {
  /** Evaluates one input against the persistent session scope. */
  evaluate(input: string, handlers?: ConsoleStreamHandlers): Promise<ReplResult>
  /** Starts a fresh scope; later evaluations do not see earlier state. */
  reset(): Promise<void>
  /** Terminates the worker and invalidates the session. */
  close(): void
}

/** Options for lazy Vitest/Jest workspace runs. */
export interface TestSessionOptions extends EsmwellOptions {
  /**
   * Hard timeout per run in milliseconds (default 60000 for test sessions).
   * The budget covers service-worker setup, the engine download from esm.sh,
   * and the test run itself, so keep it well above the judge default.
   */
  readonly timeoutMs?: number
  /**
   * Same-origin module service worker. Defaults to
   * `module-service-worker.mjs` next to the main esmwell module.
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

/** Options for one-shot virtual ESM module-project runs. */
export interface ModuleProjectSessionOptions extends EsmwellOptions {
  /**
   * Same-origin module service worker. Defaults to
   * `module-service-worker.mjs` next to the main esmwell module.
   */
  readonly serviceWorkerUrl?: string | URL
}

/** A module-project session; each run receives a fresh execution worker. */
export interface ModuleProjectSession {
  /** Imports one canonical entry from a virtual ESM project. */
  run(project: ModuleProject, handlers?: ConsoleStreamHandlers): Promise<ModuleProjectResult>
  /** Prevents future runs. An in-flight run still settles normally. */
  close(): void
}

const DEFAULT_TIMEOUT_MS = 5000
const SUPERVISOR_WATCHDOG_GRACE_MS = 1000

/**
 * Test runs download the engine from esm.sh inside the same timed request as
 * the user's tests, so the judge/REPL default would report a cold download
 * as a user timeout.
 */
const DEFAULT_TEST_TIMEOUT_MS = 60_000

/**
 * Creates a judge session backed by a trusted coordinator worker. Console
 * output streams through `onConsoleChunk` while a fresh child executes the
 * module. A run that exceeds `timeoutMs` terminates only that child and
 * resolves to a timeout error result.
 */
export function createEsmwell(options: EsmwellOptions = {}): EsmwellSession {
  const transport = new WorkerTransport(options, SUPERVISOR_WATCHDOG_GRACE_MS)
  const executionWorkerUrl = resolveExecutionWorkerUrl(options.executionWorkerUrl, 'execution-worker-entry.mjs')

  return {
    runJudge(code, cases, handlers) {
      if (transport.isClosed) {
        return Promise.reject(new Error('esmwell session is closed'))
      }
      const judgeRequest = (source: string): Omit<WorkerRequestShape, 'id'> => ({
        kind: 'judge',
        code: source,
        cases,
        timeoutMs: transport.timeoutMs,
        executionWorkerUrl,
        ...(options.deps === undefined ? {} : { deps: options.deps }),
        ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
      })
      return transport
        .request(
          options.transform === undefined
            ? judgeRequest(code)
            : () => applyTransform(options.transform, code, { kind: 'judge' }).then(judgeRequest),
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
 * Creates a REPL session backed by a trusted coordinator worker. Declarations,
 * including named declarations wrapped in ESM export syntax, imports, and
 * reassignments persist in one child across `evaluate` calls; `reset()` starts
 * a fresh scope. A hung evaluation terminates the child, so the next evaluation
 * starts fresh and state does not survive a timeout.
 */
export function createReplSession(options: EsmwellOptions = {}): ReplSession {
  const transport = new WorkerTransport(options, SUPERVISOR_WATCHDOG_GRACE_MS)
  const executionWorkerUrl = resolveExecutionWorkerUrl(options.executionWorkerUrl, 'execution-worker-entry.mjs')
  let closed = false

  return {
    evaluate(input, handlers) {
      if (closed) {
        return Promise.reject(new Error('esmwell session is closed'))
      }
      const replRequest = (source: string): Omit<WorkerRequestShape, 'id'> => ({
        kind: 'repl-input',
        input: source,
        timeoutMs: transport.timeoutMs,
        executionWorkerUrl,
        ...(options.deps === undefined ? {} : { deps: options.deps }),
        ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
      })
      return transport
        .request(
          options.transform === undefined
            ? replRequest(input)
            : () => applyTransform(options.transform, input, { kind: 'repl' }).then(replRequest),
          'repl-result',
          handlers,
        )
        .then((outcome) => asReplResult(outcome, transport.timeoutMs))
    },
    reset(): Promise<void> {
      if (closed) {
        return Promise.reject(new Error('esmwell session is closed'))
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
        throw new Error('esmwell test session is closed')
      }
      const startedAt = performance.now()
      const timeoutMs = options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS
      const deadline = startedAt + timeoutMs
      try {
        const modules = await transformGraphModules(options.transform, run.modules, 'test')
        const outcome = await requestModuleGraphWorker(
          options,
          deadline,
          timeoutMs,
          'test-worker-entry.mjs',
          (graphId, serviceWorkerScope) => ({
            kind: 'test',
            run: { ...run, modules },
            graphId,
            serviceWorkerScope,
            ...(options.deps === undefined ? {} : { deps: options.deps }),
            ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
          }),
          'test-result',
          handlers,
        )
        return asTestResult(outcome, timeoutMs)
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
      }
    },
    close(): void {
      closed = true
    },
  }
}

/**
 * Creates a one-shot virtual ESM project session. Every call uses a fresh
 * page-owned worker so timeouts and fatal failures discard the entire realm.
 */
export function createModuleProjectSession(options: ModuleProjectSessionOptions = {}): ModuleProjectSession {
  let closed = false

  return {
    async run(project, handlers): Promise<ModuleProjectResult> {
      if (closed) {
        throw new Error('esmwell module-project session is closed')
      }
      const startedAt = performance.now()
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const deadline = startedAt + timeoutMs
      try {
        const modules = await transformGraphModules(options.transform, project.modules, 'project')
        const outcome = await requestModuleGraphWorker(
          options,
          deadline,
          timeoutMs,
          'project-worker-entry.mjs',
          (graphId, serviceWorkerScope) => ({
            kind: 'module-project',
            project: { ...project, modules },
            graphId,
            serviceWorkerScope,
            ...(options.deps === undefined ? {} : { deps: options.deps }),
            ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
          }),
          'module-project-result',
          handlers,
        )
        return asModuleProjectResult(outcome, timeoutMs)
      } catch (error) {
        return {
          status: 'error',
          ok: false,
          exports: {},
          console: [],
          dependencies: [],
          error: serializedMainError(error),
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }
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
  | { kind: 'execution-timeout'; console: ConsoleChunk[] }
  | { kind: 'supervisor-timeout'; console: ConsoleChunk[] }
  | { kind: 'worker-error'; message: string; console: ConsoleChunk[] }
  /** The main-thread `transform` threw before anything reached the worker. */
  | { kind: 'transform-error'; error: unknown }

/** A request payload, or a thunk that builds it inside the session queue. */
type RequestInput = Omit<WorkerRequestShape, 'id'> | (() => Promise<Omit<WorkerRequestShape, 'id'>>)

const applyTransform = async (
  transform: SourceTransform | undefined,
  source: string,
  context: SourceTransformContext,
): Promise<string> => {
  if (transform === undefined) {
    return source
  }
  const transformed = await transform(source, context)
  if (typeof transformed !== 'string') {
    throw new TypeError(`transform must return a string, received ${typeof transformed}`)
  }
  return transformed
}

const transformGraphModules = async (
  transform: SourceTransform | undefined,
  modules: TestModules | ModuleProjectModules,
  kind: 'test' | 'project',
): Promise<Readonly<Record<string, string>>> => {
  if (transform === undefined) {
    return modules
  }
  // One run submits its modules together, so they transform concurrently;
  // submission order only sequences separate runs.
  const transformed = await Promise.all(
    Object.entries(modules).map(
      async ([id, source]) => [id, await applyTransform(transform, source, { kind, id })] as const,
    ),
  )
  return Object.fromEntries(transformed)
}

interface PendingRequest {
  settle: (outcome: TransportOutcome) => void
  resultKind: 'result' | 'repl-result' | 'repl-ack' | 'test-result' | 'module-project-result'
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
  private readonly watchdogMs: number
  private readonly timeoutOutcomeKind: 'execution-timeout' | 'supervisor-timeout'
  private worker: WorkerLike | null = null
  private closed = false
  private nextRequestId = 1
  private queue: Promise<unknown> = Promise.resolve()
  /** The one request currently in flight, if any (requests are serialized). */
  private pending: PendingRequest | null = null

  constructor(options: EsmwellOptions, watchdogGraceMs: number = 0) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.watchdogMs = this.timeoutMs + watchdogGraceMs
    this.timeoutOutcomeKind = watchdogGraceMs === 0 ? 'execution-timeout' : 'supervisor-timeout'
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
    input: RequestInput,
    resultKind: PendingRequest['resultKind'],
    handlers?: ConsoleStreamHandlers,
  ): Promise<TransportOutcome> {
    const run = this.queue.then(
      () => this.prepareAndDispatch(input, resultKind, handlers),
      () => this.prepareAndDispatch(input, resultKind, handlers),
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Builds the payload inside the queue, so an asynchronous transform for one
   * request cannot let a later request overtake it.
   */
  private prepareAndDispatch(
    input: RequestInput,
    resultKind: PendingRequest['resultKind'],
    handlers: ConsoleStreamHandlers | undefined,
  ): Promise<TransportOutcome> {
    if (typeof input !== 'function') {
      return this.dispatch(input, resultKind, handlers)
    }
    return input().then(
      (message) => this.dispatch(message, resultKind, handlers),
      (error: unknown) => ({ kind: 'transform-error', error }),
    )
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
            response.kind === 'result' ||
            response.kind === 'repl-result' ||
            response.kind === 'test-result' ||
            response.kind === 'module-project-result'
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
        pending.finish({ kind: this.timeoutOutcomeKind, console: pending.pendingChunks })
      }, this.watchdogMs)

      sessionWorker.addEventListener('message', onMessage)
      sessionWorker.addEventListener('error', onError)
      try {
        sessionWorker.send({ ...message, id })
      } catch (error) {
        pending.finish({
          kind: 'worker-error',
          message: `could not send the request to the worker: ${error instanceof Error ? error.message : String(error)} — request payloads must contain only structured-cloneable values (no functions, symbols, or proxies)`,
          console: pending.pendingChunks,
        })
      }
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

const asJudgeResult = (outcome: TransportOutcome, timeoutMs: number): JudgeRunResult => {
  if (outcome.kind === 'delivered') {
    return outcome.payload as JudgeRunResult
  }
  if (outcome.kind === 'supervisor-timeout') {
    return workerErrorResult(supervisorTimeoutMessage(timeoutMs), outcome.console)
  }
  if (outcome.kind === 'execution-timeout') {
    return timeoutResult(timeoutMs, outcome.console)
  }
  if (outcome.kind === 'transform-error') {
    return {
      status: 'error',
      ok: false,
      cases: [],
      console: [],
      error: serializedMainError(outcome.error),
      dependencies: [],
      durationMs: 0,
    }
  }
  return workerErrorResult(outcome.message, outcome.console)
}

const asReplResult = (outcome: TransportOutcome, timeoutMs: number): ReplResult => {
  if (outcome.kind === 'delivered') {
    return outcome.payload as ReplResult
  }
  if (outcome.kind === 'supervisor-timeout') {
    return {
      ok: false,
      error: workerError(supervisorTimeoutMessage(timeoutMs)),
      console: outcome.console,
      dependencies: [],
      durationMs: 0,
    }
  }
  if (outcome.kind === 'execution-timeout') {
    return {
      ok: false,
      error: timeoutError(timeoutMs),
      console: outcome.console,
      dependencies: [],
      durationMs: timeoutMs,
    }
  }
  if (outcome.kind === 'transform-error') {
    return {
      ok: false,
      error: serializedMainError(outcome.error),
      console: [],
      dependencies: [],
      durationMs: 0,
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
  if (outcome.kind === 'supervisor-timeout') {
    return {
      status: 'error',
      ok: false,
      tests: [],
      console: outcome.console,
      dependencies: [],
      error: workerError(supervisorTimeoutMessage(timeoutMs)),
      durationMs: 0,
    }
  }
  if (outcome.kind === 'execution-timeout') {
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
  if (outcome.kind === 'transform-error') {
    return {
      status: 'error',
      ok: false,
      tests: [],
      console: [],
      dependencies: [],
      error: serializedMainError(outcome.error),
      durationMs: 0,
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

const asModuleProjectResult = (outcome: TransportOutcome, timeoutMs: number): ModuleProjectResult => {
  if (outcome.kind === 'delivered') {
    return outcome.payload as ModuleProjectResult
  }
  if (outcome.kind === 'execution-timeout') {
    return {
      status: 'error',
      ok: false,
      exports: {},
      console: outcome.console,
      dependencies: [],
      error: timeoutError(timeoutMs),
      durationMs: timeoutMs,
    }
  }
  const error =
    outcome.kind === 'transform-error'
      ? serializedMainError(outcome.error)
      : workerError(outcome.kind === 'supervisor-timeout' ? supervisorTimeoutMessage(timeoutMs) : outcome.message)
  return {
    status: 'error',
    ok: false,
    exports: {},
    console: outcome.kind === 'transform-error' ? [] : outcome.console,
    dependencies: [],
    error,
    durationMs: 0,
  }
}

const workerErrorResult = (message: string, console: ConsoleChunk[]): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console,
  error: workerError(message),
  dependencies: [],
  durationMs: 0,
})

const timeoutResult = (timeoutMs: number, console: ConsoleChunk[]): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console,
  error: timeoutError(timeoutMs),
  dependencies: [],
  durationMs: timeoutMs,
})

const timeoutError = (timeoutMs: number): SerializedError => ({
  name: 'TimeoutError',
  message: `execution timed out after ${timeoutMs}ms and its worker was terminated`,
})

const workerError = (message: string): SerializedError => ({
  name: 'EsmwellError',
  message,
})

const supervisorTimeoutMessage = (timeoutMs: number): string =>
  `the execution supervisor did not settle the request within ${timeoutMs}ms plus its watchdog grace period and was terminated`

type ModuleGraphSessionOptions = TestSessionOptions | ModuleProjectSessionOptions

type ModuleGraphRequestFactory = (graphId: string, serviceWorkerScope: string) => Omit<WorkerRequestShape, 'id'>

const requestModuleGraphWorker = async (
  options: ModuleGraphSessionOptions,
  deadline: number,
  timeoutMs: number,
  defaultWorkerFile: string,
  createRequest: ModuleGraphRequestFactory,
  resultKind: PendingRequest['resultKind'],
  handlers: ConsoleStreamHandlers | undefined,
): Promise<TransportOutcome> => {
  const graphId = createGraphId()
  let transport: WorkerTransport | undefined
  try {
    const serviceWorkerScope = await prepareModuleServiceWorker(options, deadline, timeoutMs)
    const workerUrl = resolveModuleWorkerUrl(options, defaultWorkerFile)
    assertModuleWorkerWithinScope(workerUrl, serviceWorkerScope)
    transport = new WorkerTransport({
      ...options,
      timeoutMs: remainingTimeoutMs(deadline, timeoutMs),
      workerUrl,
    })
    return await transport.request(createRequest(graphId, serviceWorkerScope), resultKind, handlers)
  } finally {
    transport?.close()
    await deleteModuleGraphCache(graphId)
  }
}

const prepareModuleServiceWorker = async (
  options: ModuleGraphSessionOptions,
  deadline: number,
  timeoutMs: number,
): Promise<string> => {
  if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) {
    throw new Error('virtual module graphs require Service Worker support in a secure browser context')
  }
  const serviceWorkerUrl =
    options.serviceWorkerUrl === undefined
      ? new URL(/* @vite-ignore */ 'module-service-worker.mjs', import.meta.url)
      : new URL(String(options.serviceWorkerUrl), globalThis.location?.href)
  if (serviceWorkerUrl.origin !== globalThis.location?.origin) {
    throw new Error('the module service worker must be served from the website origin')
  }
  const scope = new URL('./', serviceWorkerUrl).href
  const registration = await withinModuleGraphDeadline(
    navigator.serviceWorker.register(serviceWorkerUrl, { type: 'module', scope }),
    deadline,
    timeoutMs,
  )
  await waitForActiveWorker(registration, deadline, timeoutMs)
  return registration.scope
}

const waitForActiveWorker = async (
  registration: ServiceWorkerRegistration,
  deadline: number,
  timeoutMs: number,
): Promise<void> => {
  if (registration.active !== null) {
    return
  }
  const worker = registration.installing ?? registration.waiting
  if (worker === null) {
    throw new Error('the module service worker did not start installing')
  }
  let onStateChange: (() => void) | undefined
  const activation = new Promise<void>((resolve, reject) => {
    onStateChange = (): void => {
      if (worker.state === 'activated') {
        resolve()
      } else if (worker.state === 'redundant') {
        reject(new Error('the module service worker became redundant during installation'))
      }
    }
    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
  try {
    await withinModuleGraphDeadline(activation, deadline, timeoutMs)
  } finally {
    if (onStateChange !== undefined) {
      worker.removeEventListener('statechange', onStateChange)
    }
  }
}

class ModuleGraphRunDeadlineError extends Error {
  override readonly name = 'TimeoutError'

  constructor(timeoutMs: number) {
    super(`module graph run timed out after ${timeoutMs}ms during service-worker setup or execution`)
  }
}

const withinModuleGraphDeadline = async <T>(promise: Promise<T>, deadline: number, timeoutMs: number): Promise<T> => {
  const remaining = deadline - performance.now()
  if (remaining <= 0) throw new ModuleGraphRunDeadlineError(timeoutMs)

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ModuleGraphRunDeadlineError(timeoutMs)), remaining)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const remainingTimeoutMs = (deadline: number, timeoutMs: number): number => {
  const remaining = Math.ceil(deadline - performance.now())
  if (remaining <= 0) throw new ModuleGraphRunDeadlineError(timeoutMs)
  return remaining
}

const resolveModuleWorkerUrl = (options: ModuleGraphSessionOptions, defaultFile: string): URL =>
  options.workerUrl === undefined
    ? new URL(/* @vite-ignore */ defaultFile, import.meta.url)
    : new URL(String(options.workerUrl), globalThis.location?.href)

const resolveExecutionWorkerUrl = (value: string | URL | undefined, defaultFile: string): string =>
  value === undefined
    ? new URL(defaultFile, import.meta.url).href
    : new URL(String(value), globalThis.location?.href ?? import.meta.url).href

const assertModuleWorkerWithinScope = (workerUrl: URL, scope: string): void => {
  if (!workerUrl.href.startsWith(scope)) {
    throw new Error(
      `the module execution worker must be served under the module service-worker scope '${scope}', but resolved to '${workerUrl.href}'`,
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

const deleteModuleGraphCache = async (graphId: string): Promise<void> => {
  if (typeof caches !== 'undefined') {
    await caches.delete(`esmwell:module-graph:v1:${graphId}`)
  }
}

const serializedMainError = (error: unknown): SerializedError => {
  if (!(error instanceof Error)) {
    return { name: 'NonError', message: String(error) }
  }
  const position = errorPosition(error)
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...position,
  }
}

/** Carries a transform's `line`/`column` (a compiler diagnostic) into the result. */
const errorPosition = (error: Error): { line?: number; column?: number } => {
  const { line, column } = error as { line?: unknown; column?: unknown }
  return {
    ...(typeof line === 'number' ? { line } : {}),
    ...(typeof column === 'number' ? { column } : {}),
  }
}
