import type {
  ConsoleChunk,
  ExecutionPhase,
  JudgeCase,
  JudgeRunResult,
  ReplResult,
  SerializedError,
  WorkerResponse,
} from './types'
import { moduleGraphCacheName } from './module-graph-cache'
import type { ModuleProject, ModuleProjectModules, ModuleProjectResult } from './module-project'
import type { TestModules, TestRun, TestRunResult } from './test-types'
import type { HostTools, HostToolsConnection } from './host-tools-protocol'
import type { SourceTransform, SourceTransformContext } from './transform'
import { adaptWorker, createModuleWorker, executionTimeoutMessage, type WorkerLike } from './worker-like'

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
  /**
   * Hard worker timeout in milliseconds (default 5000). Judge and REPL host
   * transforms get a separate budget of the same length.
   */
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
  /** Optional named functions the execution worker may call on the main thread. */
  readonly hostTools?: HostTools
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
const MODULE_GRAPH_CACHE_DELETE_ATTEMPTS = 8

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
        .then((outcome) => asRunResult<JudgeRunResult>(outcome, transport.timeoutMs, { status: 'error', cases: [] }))
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

  return {
    evaluate(input, handlers) {
      if (transport.isClosed) {
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
        .then((outcome) => asRunResult<ReplResult>(outcome, transport.timeoutMs, {}))
    },
    reset(): Promise<void> {
      if (transport.isClosed) {
        return Promise.reject(new Error('esmwell session is closed'))
      }
      return transport.request({ kind: 'repl-reset' }, 'repl-ack').then(() => undefined)
    },
    close(): void {
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
  const lifecycle = new AbortController()
  const transformModules = createGraphModuleTransform(options.transform, 'test', lifecycle.signal)

  return {
    async run(run, handlers): Promise<TestRunResult> {
      if (lifecycle.signal.aborted) {
        throw new Error('esmwell test session is closed')
      }
      const startedAt = performance.now()
      const timeoutMs = options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS
      const deadline = startedAt + timeoutMs
      let phase: ExecutionPhase = 'transform'
      try {
        const modules = await transformModules(run.modules, deadline, timeoutMs)
        phase = 'service-worker'
        const outcome = await requestModuleGraphWorker({
          options,
          signal: lifecycle.signal,
          deadline,
          timeoutMs,
          defaultWorkerFile: 'test-worker-entry.mjs',
          createRequest: (graphId, serviceWorkerScope) => ({
            kind: 'test',
            run: { ...run, modules },
            graphId,
            serviceWorkerScope,
            ...(options.deps === undefined ? {} : { deps: options.deps }),
            ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
          }),
          resultKind: 'test-result',
          handlers,
        })
        return asRunResult<TestRunResult>(outcome, timeoutMs, { status: 'error', tests: [] })
      } catch (error) {
        return asRunResult<TestRunResult>(preparationFailure(error, phase, startedAt), timeoutMs, {
          status: 'error',
          tests: [],
        })
      }
    },
    close(): void {
      lifecycle.abort(new Error('the session was closed while this run was still in progress'))
    },
  }
}

/**
 * Creates a one-shot virtual ESM project session. Every call uses a fresh
 * page-owned worker so timeouts and fatal failures discard the entire realm.
 */
export function createModuleProjectSession(options: ModuleProjectSessionOptions = {}): ModuleProjectSession {
  const lifecycle = new AbortController()
  const transformModules = createGraphModuleTransform(options.transform, 'project', lifecycle.signal)

  return {
    async run(project, handlers): Promise<ModuleProjectResult> {
      if (lifecycle.signal.aborted) {
        throw new Error('esmwell module-project session is closed')
      }
      const startedAt = performance.now()
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const deadline = startedAt + timeoutMs
      let phase: ExecutionPhase = 'transform'
      try {
        const modules = await transformModules(project.modules, deadline, timeoutMs)
        phase = 'service-worker'
        const outcome = await requestModuleGraphWorker({
          options,
          signal: lifecycle.signal,
          deadline,
          timeoutMs,
          defaultWorkerFile: 'project-worker-entry.mjs',
          createRequest: (graphId, serviceWorkerScope) => ({
            kind: 'module-project',
            project: { ...project, modules },
            graphId,
            serviceWorkerScope,
            ...(options.deps === undefined ? {} : { deps: options.deps }),
            ...(options.autoInstall === undefined ? {} : { autoInstall: options.autoInstall }),
          }),
          resultKind: 'module-project-result',
          handlers,
        })
        return asRunResult<ModuleProjectResult>(outcome, timeoutMs, { status: 'error', exports: {} })
      } catch (error) {
        return asRunResult<ModuleProjectResult>(preparationFailure(error, phase, startedAt), timeoutMs, {
          status: 'error',
          exports: {},
        })
      }
    },
    close(): void {
      lifecycle.abort(new Error('the session was closed while this run was still in progress'))
    },
  }
}

type WorkerOutcome =
  | { kind: 'delivered'; payload: unknown }
  | { kind: 'execution-timeout' }
  | { kind: 'supervisor-timeout' }
  | { kind: 'worker-error'; message: string }

type TransportOutcome = (
  | (WorkerOutcome & { console: ConsoleChunk[] })
  | { kind: 'preparation-error'; error: unknown; durationMs: number }
) & { phase?: ExecutionPhase }

/** A request payload, or a thunk that builds it inside the session queue. */
type RequestInput = Omit<WorkerRequestShape, 'id'> | (() => Promise<Omit<WorkerRequestShape, 'id'>>)

const preparationFailure = (error: unknown, phase: ExecutionPhase, startedAt?: number): TransportOutcome => ({
  kind: 'preparation-error',
  error,
  phase,
  durationMs: startedAt === undefined ? 0 : Math.round((performance.now() - startedAt) * 100) / 100,
})

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

const createTransformQueue = (signal: AbortSignal) => {
  const waiting = new Set<() => void>()
  let active: (() => void) | undefined

  const startNext = (): void => {
    active = waiting.values().next().value
    if (active === undefined) return
    waiting.delete(active)
    active()
  }

  return <T>(
    transform: () => Promise<T>,
    deadline: number,
    timeoutMs: number,
    ready?: Promise<unknown>,
  ): Promise<T> => {
    let start: () => void
    const task = new Promise<T>((resolve, reject) => {
      start = () => {
        void (ready ?? Promise.resolve())
          .then(() => {
            signal.throwIfAborted()
            remainingTimeoutMs(deadline, timeoutMs, 'transform')
            return transform()
          })
          .then(resolve, reject)
          .then(startNext)
      }
      waiting.add(start)
      if (active === undefined) startNext()
    })
    const result = withinRunDeadline(task, deadline, timeoutMs, signal, 'transform')
    const remove = (): void => {
      waiting.delete(start)
    }
    void result.then(remove, remove)
    return result
  }
}

const createGraphModuleTransform = (
  transform: SourceTransform | undefined,
  kind: 'test' | 'project',
  signal: AbortSignal,
) => {
  const enqueue = createTransformQueue(signal)
  return (modules: TestModules | ModuleProjectModules, deadline: number, timeoutMs: number) => {
    if (transform === undefined) {
      return Promise.resolve(modules)
    }
    return enqueue(
      async () => {
        // Wait for siblings of a failed transform before the next batch starts.
        const transformed = await Promise.allSettled(
          Object.entries(modules).map(
            async ([id, source]) => [id, await applyTransform(transform, source, { kind, id })] as const,
          ),
        )
        return Object.fromEntries(
          transformed.map((result) => {
            if (result.status === 'rejected') throw result.reason
            return result.value
          }),
        )
      },
      deadline,
      timeoutMs,
    )
  }
}

type ResultKind = Exclude<WorkerResponse['kind'], 'console' | 'phase'>

interface PendingRequest {
  readonly finish: (outcome: WorkerOutcome) => void
}

/**
 * Owns the pairing, streaming, timeout, and lifecycle logic shared by judge
 * and REPL sessions. One request is in flight at a time; requests queue.
 */
class WorkerTransport {
  readonly timeoutMs: number

  private readonly workerFactory: WorkerFactory
  private readonly hostTools: HostTools | undefined
  private readonly workerUrl: string
  private readonly watchdogGraceMs: number
  private worker: WorkerLike | null = null
  private readonly lifecycle = new AbortController()
  private readonly enqueueTransform = createTransformQueue(this.lifecycle.signal)
  private nextRequestId = 1
  private queue: Promise<unknown> = Promise.resolve()
  /** The one request currently in flight, if any (requests are serialized). */
  private pending: PendingRequest | null = null

  constructor(options: EsmwellOptions, watchdogGraceMs: number = 0) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.watchdogGraceMs = watchdogGraceMs
    this.workerFactory = options.workerFactory ?? createModuleWorker
    this.hostTools = options.hostTools
    this.workerUrl =
      options.workerUrl !== undefined
        ? String(options.workerUrl)
        : // Bundlers try to resolve this at build time; the default only
          // matters when the build output is served as-is (next to
          // worker-entry.mjs), so it must stay a runtime resolution.
          new URL(/* @vite-ignore */ 'worker-entry.mjs', import.meta.url).href
  }

  request(input: RequestInput, resultKind: ResultKind, handlers?: ConsoleStreamHandlers): Promise<TransportOutcome> {
    const turn = this.queue
    const dispatch = (message: Omit<WorkerRequestShape, 'id'>): Promise<TransportOutcome> =>
      this.dispatch(message, resultKind, handlers)

    const hasTransform = typeof input === 'function'
    const run = hasTransform
      ? this.enqueueTransform(input, performance.now() + this.timeoutMs, this.timeoutMs, turn).then(
          dispatch,
          (error: unknown) => preparationFailure(error, 'transform'),
        )
      : turn.then(() => dispatch(input))
    // A transform can time out while the earlier worker still owns the session.
    this.queue = (hasTransform ? turn.then(() => run) : run).catch(() => undefined)
    return run
  }

  close(): void {
    this.lifecycle.abort(new Error('the session was closed while this run was still in progress'))
    const active = this.pending
    if (active !== null) {
      active.finish({
        kind: 'worker-error',
        message: 'the session was closed while this run was still in progress',
      })
    }
    this.terminateWorker()
  }

  get isClosed(): boolean {
    return this.lifecycle.signal.aborted
  }

  private dispatch(
    message: Omit<WorkerRequestShape, 'id'>,
    resultKind: ResultKind,
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

      let phase: ExecutionPhase = 'worker-start'
      const id = this.nextRequestId
      this.nextRequestId += 1

      const pendingChunks: ConsoleChunk[] = []
      let settled = false
      let tools: HostToolsConnection | undefined

      const onMessage = (event: unknown): void => {
        const response = (event as MessageEvent<WorkerResponse>).data
        if (response?.id !== id) {
          return
        }
        if (response.kind === 'phase') {
          phase = response.phase
          return
        }
        if (response.kind === 'console') {
          pendingChunks.push(response.chunk)
          handlers?.onConsoleChunk?.(response.chunk)
          return
        }
        if (response.kind === resultKind) {
          const payload = response.kind === 'repl-ack' ? undefined : response.result
          finish({ kind: 'delivered', payload })
          return
        }
        finish({
          kind: 'worker-error',
          message: `worker responded with unexpected message kind '${String(response.kind)}' for this request`,
        })
      }

      const onError = (event: unknown): void => {
        const failure = (event as ErrorEvent).message
        this.terminateWorker()
        finish({ kind: 'worker-error', message: String(failure) })
      }

      const finish = (outcome: WorkerOutcome): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        sessionWorker.removeEventListener('message', onMessage)
        sessionWorker.removeEventListener('error', onError)
        if (this.pending === pending) {
          this.pending = null
        }
        tools?.close()
        resolve({ ...outcome, console: pendingChunks, phase })
      }

      const pending = { finish }
      this.pending = pending
      const timer = setTimeout(() => {
        this.terminateWorker()
        finish({
          kind: this.watchdogGraceMs === 0 ? 'execution-timeout' : 'supervisor-timeout',
        })
      }, this.timeoutMs + this.watchdogGraceMs)

      sessionWorker.addEventListener('message', onMessage)
      sessionWorker.addEventListener('error', onError)
      try {
        tools = message.kind === 'repl-reset' ? undefined : this.hostTools?.open()
        const request = { ...message, id }
        if (tools === undefined) sessionWorker.send(request)
        else sessionWorker.send({ ...request, hostToolsPort: tools.port }, [tools.port])
      } catch (error) {
        finish({
          kind: 'worker-error',
          message: `could not send the request to the worker: ${error instanceof Error ? error.message : String(error)} — request payloads must contain only structured-cloneable values (no functions, symbols, or proxies)`,
        })
      }
    })
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker === null && !this.isClosed) {
      const created = this.workerFactory(this.workerUrl)
      const onMessageError = (): void => {
        created.removeEventListener('messageerror', onMessageError)
        const active = this.pending
        this.terminateWorker()
        if (active !== null) {
          active.finish({
            kind: 'worker-error',
            message: 'the worker sent a message the main thread could not decode (messageerror)',
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

type DeliveredOutcome = Extract<TransportOutcome, { kind: 'delivered' }>

const asRunResult = <Result extends ReplResult>(
  outcome: TransportOutcome,
  timeoutMs: number,
  fallback: Omit<Result, keyof ReplResult>,
): Result | (typeof fallback & ReturnType<typeof transportFailure>) => {
  if (outcome.kind !== 'delivered') return { ...fallback, ...transportFailure(outcome, timeoutMs) }
  // The transport only accepts a result of the requested kind.
  const result = outcome.payload as Result
  return result.error === undefined ? result : { ...result, error: withPhase(result.error, outcome.phase) }
}

const withPhase = (error: SerializedError, phase: ExecutionPhase | undefined): SerializedError =>
  phase === undefined || error.phase !== undefined ? error : { ...error, phase }

const transportFailure = (outcome: Exclude<TransportOutcome, DeliveredOutcome>, timeoutMs: number) => {
  const error =
    outcome.kind === 'preparation-error'
      ? serializedMainError(outcome.error)
      : outcome.kind === 'execution-timeout'
        ? { name: 'TimeoutError', message: executionTimeoutMessage(timeoutMs) }
        : {
            name: 'EsmwellError',
            message: outcome.kind === 'worker-error' ? outcome.message : supervisorTimeoutMessage(timeoutMs),
          }
  return {
    ok: false as const,
    console: outcome.kind === 'preparation-error' ? [] : outcome.console,
    dependencies: [],
    error: withPhase(error, outcome.phase),
    durationMs:
      outcome.kind === 'preparation-error' ? outcome.durationMs : outcome.kind === 'execution-timeout' ? timeoutMs : 0,
  }
}

const supervisorTimeoutMessage = (timeoutMs: number): string =>
  `the execution supervisor did not settle the request within ${timeoutMs}ms plus its watchdog grace period and was terminated`

type ModuleGraphSessionOptions = TestSessionOptions | ModuleProjectSessionOptions

type ModuleGraphRequestFactory = (graphId: string, serviceWorkerScope: string) => Omit<WorkerRequestShape, 'id'>

interface ModuleGraphWorkerRequestOptions {
  readonly signal: AbortSignal
  readonly options: ModuleGraphSessionOptions
  readonly deadline: number
  readonly timeoutMs: number
  readonly defaultWorkerFile: string
  readonly createRequest: ModuleGraphRequestFactory
  readonly resultKind: ResultKind
  readonly handlers: ConsoleStreamHandlers | undefined
}

const requestModuleGraphWorker = async ({
  options,
  signal,
  deadline,
  timeoutMs,
  defaultWorkerFile,
  createRequest,
  resultKind,
  handlers,
}: ModuleGraphWorkerRequestOptions): Promise<TransportOutcome> => {
  const graphId = createGraphId()
  let transport: WorkerTransport | undefined
  const close = (): void => transport?.close()
  try {
    signal.throwIfAborted()
    const serviceWorkerScope = await prepareModuleServiceWorker(options, deadline, timeoutMs, signal)
    signal.throwIfAborted()
    const workerUrl = resolveModuleWorkerUrl(options, defaultWorkerFile)
    assertModuleWorkerWithinScope(workerUrl, serviceWorkerScope)
    transport = new WorkerTransport({
      ...options,
      timeoutMs: remainingTimeoutMs(deadline, timeoutMs),
      workerUrl,
    })
    signal.addEventListener('abort', close, { once: true })
    return await transport.request(createRequest(graphId, serviceWorkerScope), resultKind, handlers)
  } finally {
    signal.removeEventListener('abort', close)
    transport?.close()
    await deleteModuleGraphCache(graphId)
  }
}

const prepareModuleServiceWorker = async (
  options: ModuleGraphSessionOptions,
  deadline: number,
  timeoutMs: number,
  signal: AbortSignal,
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
  const registration = await withinRunDeadline(
    navigator.serviceWorker.register(serviceWorkerUrl, { type: 'module', scope }),
    deadline,
    timeoutMs,
    signal,
  )
  signal.throwIfAborted()
  await waitForActiveWorker(registration, deadline, timeoutMs, signal)
  return registration.scope
}

const waitForActiveWorker = async (
  registration: ServiceWorkerRegistration,
  deadline: number,
  timeoutMs: number,
  signal: AbortSignal,
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
    await withinRunDeadline(activation, deadline, timeoutMs, signal)
  } finally {
    if (onStateChange !== undefined) {
      worker.removeEventListener('statechange', onStateChange)
    }
  }
}

type PreparationPhase = 'service-worker' | 'transform'

const deadlineError = (timeoutMs: number, phase: PreparationPhase): Error => {
  const error = new Error(
    phase === 'transform'
      ? `host transform timed out after ${timeoutMs}ms`
      : `module graph run timed out after ${timeoutMs}ms during service-worker setup or execution`,
  )
  error.name = 'TimeoutError'
  return error
}

const withinRunDeadline = async <T>(
  pending: Promise<T>,
  deadline: number,
  timeoutMs: number,
  signal: AbortSignal,
  phase: PreparationPhase = 'service-worker',
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const value = await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(signal.reason)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => reject(deadlineError(timeoutMs, phase)), deadline - performance.now())
      void pending.then(resolve, reject)
    })
    remainingTimeoutMs(deadline, timeoutMs, phase)
    return value
  } finally {
    clearTimeout(timer)
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

const remainingTimeoutMs = (
  deadline: number,
  timeoutMs: number,
  phase: PreparationPhase = 'service-worker',
): number => {
  const remaining = Math.ceil(deadline - performance.now())
  if (remaining <= 0) throw deadlineError(timeoutMs, phase)
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
  if (typeof caches === 'undefined') {
    return
  }
  const cacheName = moduleGraphCacheName(graphId)
  for (let attempt = 0; attempt < MODULE_GRAPH_CACHE_DELETE_ATTEMPTS; attempt += 1) {
    await caches.delete(cacheName)
    if (!(await caches.has(cacheName))) {
      return
    }
  }
  await caches.delete(cacheName)
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
