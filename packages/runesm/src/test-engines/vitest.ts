const ESM_SH_ORIGIN = 'https://esm.sh'
const LATEST_RUNNER_URL = `${ESM_SH_ORIGIN}/@vitest/runner@latest`

export type VitestImportSource = 'collect' | 'setup'

/** Exact package URLs the test-module loader must use while rewriting imports. */
export interface VitestEngineImports {
  readonly version: string
  readonly vitestUrl: string
  readonly runnerUrl: string
  readonly expectUrl: string
}

export interface VitestImportContext extends VitestEngineImports {
  readonly source: VitestImportSource
}

export type VitestImportTestFile = (filepath: string, context: VitestImportContext) => Promise<unknown>

export interface VitestEngineOptions {
  readonly files: readonly string[]
  readonly importTestFile: VitestImportTestFile
  readonly fetch?: typeof globalThis.fetch
  readonly testTimeoutMs?: number
  readonly hookTimeoutMs?: number
}

export interface VitestSerializedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

export type VitestTestStatus = 'pass' | 'fail' | 'skip' | 'todo'

export interface VitestTestResult {
  readonly id: string
  readonly name: string
  readonly fullName: string
  readonly filepath: string
  readonly status: VitestTestStatus
  readonly durationMs: number
  readonly errors: readonly VitestSerializedError[]
}

export interface VitestFileResult {
  readonly filepath: string
  readonly status: 'pass' | 'fail'
  readonly durationMs: number
  readonly errors: readonly VitestSerializedError[]
  readonly tests: readonly VitestTestResult[]
}

export interface VitestSnapshotFile {
  readonly filepath: string
  readonly content: string
}

export interface VitestEngineResult {
  readonly ok: boolean
  readonly version?: string
  readonly imports?: VitestEngineImports
  readonly files: readonly VitestFileResult[]
  readonly snapshots: readonly VitestSnapshotFile[]
  readonly durationMs: number
  readonly error?: VitestSerializedError
}

interface RuntimeTaskResult {
  readonly state?: unknown
  readonly duration?: unknown
  readonly errors?: unknown
}

interface RuntimeTask {
  readonly id?: unknown
  readonly name?: unknown
  readonly type?: unknown
  readonly mode?: unknown
  readonly result?: RuntimeTaskResult
  readonly tasks?: unknown
}

interface RuntimeFile extends RuntimeTask {
  readonly filepath?: unknown
}

interface RuntimeRunner {
  moduleRunner?: unknown
  importFile?: unknown
  __setTraces?: (traces: RuntimeTraces) => void
}

interface RuntimeTraces {
  readonly $: (name: string, attributesOrCallback: unknown, callback?: () => unknown) => unknown
}

interface RunnerModule {
  readonly startTests: (files: readonly string[], runner: RuntimeRunner) => Promise<unknown>
}

interface VitestModule {
  readonly TestRunner: new (config: Record<string, unknown>) => RuntimeRunner
}

interface WorkerState {
  config: Record<string, unknown>
  filepath: string
  current?: unknown
  readonly providedContext: Record<string, unknown>
  readonly metaEnv: Record<string, unknown>
  readonly ctx: { readonly pool: string }
  readonly environment: { readonly name: string }
  readonly evaluatedModules: {
    readonly getModuleById: (id: string) => undefined
    readonly invalidateModule: (module: unknown) => void
  }
  readonly onCleanup: (cleanup: () => unknown) => void
  readonly rpc: { readonly snapshotSaved: () => Promise<void> }
}

interface SnapshotEnvironment {
  readonly getVersion: () => string
  readonly getHeader: () => string
  readonly resolvePath: (filepath: string) => Promise<string>
  readonly resolveRawPath: (_testPath: string, rawPath: string) => Promise<string>
  readonly saveSnapshotFile: (filepath: string, content: string) => Promise<void>
  readonly readSnapshotFile: (filepath: string) => Promise<string | null>
  readonly removeSnapshotFile: (filepath: string) => Promise<void>
}

/**
 * Runs real Vitest packages in the current browser worker and returns only
 * structured-clone-safe data. A fresh worker is required for every call:
 * Vitest stores collection, expectation, and module state on globalThis.
 */
export async function runVitestInRealm(options: VitestEngineOptions): Promise<VitestEngineResult> {
  const startedAt = performance.now()
  let imports: VitestEngineImports | undefined

  try {
    imports = await resolveLatestVitestImports(options.fetch ?? globalThis.fetch)
    const resolvedImports = imports
    const snapshots = new Map<string, string>()
    const cleanups: Array<() => unknown> = []
    const snapshotEnvironment = createSnapshotEnvironment(snapshots)
    const config = createRunnerConfig(options, snapshotEnvironment)
    const workerState = createWorkerState(config, options.files[0] ?? '', cleanups)
    installWorkerState(workerState)

    // Loading @vitest/expect explicitly pins the assertion implementation to
    // the same exact version as the runner. The vitest entrypoint reuses it.
    await importUrl(resolvedImports.expectUrl)
    const [runnerModuleValue, vitestModuleValue] = await Promise.all([
      importUrl(resolvedImports.runnerUrl),
      importUrl(resolvedImports.vitestUrl),
    ])
    const runnerModule = readRunnerModule(runnerModuleValue)
    const vitestModule = readVitestModule(vitestModuleValue)
    const runner = new vitestModule.TestRunner(config)
    const importTestFile = async (filepath: string, source: VitestImportSource): Promise<unknown> => {
      workerState.filepath = filepath
      return options.importTestFile(filepath, { ...resolvedImports, source })
    }

    runner['__setTraces']?.({
      $: (_name, attributesOrCallback, callback) =>
        callback === undefined ? (attributesOrCallback as () => unknown)() : callback(),
    })
    runner.moduleRunner = {
      import: (filepath: string): Promise<unknown> => importTestFile(filepath, 'collect'),
    }
    runner.importFile = (filepath: string, source: VitestImportSource): Promise<unknown> =>
      importTestFile(filepath, source)

    const runtimeFiles = await runnerModule.startTests(options.files, runner)
    const files = normalizeFiles(runtimeFiles)
    await runCleanups(cleanups)

    return {
      ok: files.every((file) => file.status === 'pass'),
      version: resolvedImports.version,
      imports: resolvedImports,
      files,
      snapshots: [...snapshots].map(([filepath, content]) => ({ filepath, content })),
      durationMs: elapsedMs(startedAt),
    }
  } catch (error) {
    return {
      ok: false,
      ...(imports === undefined ? {} : { version: imports.version, imports }),
      files: [],
      snapshots: [],
      durationMs: elapsedMs(startedAt),
      error: serializeError(error),
    }
  }
}

async function resolveLatestVitestImports(fetchImplementation: typeof globalThis.fetch): Promise<VitestEngineImports> {
  const response = await fetchImplementation(LATEST_RUNNER_URL, { method: 'HEAD' })
  if (!response.ok) {
    throw new Error(`could not resolve the latest Vitest version from esm.sh: HTTP ${response.status}`)
  }

  const esmPath = response.headers.get('x-esm-path')
  const match = esmPath?.match(/^\/@vitest\/runner@([^/]+)\//)
  const version = match?.[1]
  if (version === undefined || version.length === 0) {
    throw new Error('could not resolve the latest Vitest version from esm.sh: X-ESM-Path was missing or invalid')
  }

  return {
    version,
    vitestUrl: `${ESM_SH_ORIGIN}/vitest@${version}`,
    runnerUrl: `${ESM_SH_ORIGIN}/@vitest/runner@${version}`,
    expectUrl: `${ESM_SH_ORIGIN}/@vitest/expect@${version}`,
  }
}

const createRunnerConfig = (
  options: VitestEngineOptions,
  snapshotEnvironment: SnapshotEnvironment,
): Record<string, unknown> => ({
  root: '/',
  setupFiles: [],
  name: 'runesm',
  passWithNoTests: false,
  testNamePattern: undefined,
  allowOnly: false,
  sequence: { seed: 1, hooks: 'list', setupFiles: 'list', concurrent: false, shuffle: false },
  chaiConfig: undefined,
  maxConcurrency: 1,
  testTimeout: options.testTimeoutMs ?? 5_000,
  hookTimeout: options.hookTimeoutMs ?? 5_000,
  retry: 0,
  includeTaskLocation: false,
  tags: [],
  tagsFilter: undefined,
  strictTags: false,
  fakeTimers: {},
  snapshotOptions: { expand: false, updateSnapshot: 'new', snapshotEnvironment },
  expect: { requireAssertions: false },
  experimental: { viteModuleRunner: false, importDurations: { limit: 0 } },
  clearMocks: false,
  mockReset: false,
  restoreMocks: false,
  unstubEnvs: false,
  unstubGlobals: false,
  logHeapUsage: false,
})

const createWorkerState = (
  config: Record<string, unknown>,
  filepath: string,
  cleanups: Array<() => unknown>,
): WorkerState => ({
  config,
  filepath,
  providedContext: {},
  metaEnv: {},
  ctx: { pool: 'runesm' },
  environment: { name: 'browser' },
  evaluatedModules: {
    getModuleById: () => undefined,
    invalidateModule: () => undefined,
  },
  onCleanup: (cleanup) => cleanups.push(cleanup),
  rpc: { snapshotSaved: () => Promise.resolve() },
})

const installWorkerState = (state: WorkerState): void => {
  Object.defineProperty(globalThis, '__vitest_worker__', {
    value: state,
    writable: true,
    configurable: true,
  })
}

const createSnapshotEnvironment = (snapshots: Map<string, string>): SnapshotEnvironment => ({
  getVersion: () => '1',
  getHeader: () => '',
  resolvePath: (filepath) => Promise.resolve(`${filepath}.snap`),
  resolveRawPath: (_testPath, rawPath) => Promise.resolve(rawPath),
  saveSnapshotFile: (filepath, content) => {
    snapshots.set(filepath, content)
    return Promise.resolve()
  },
  readSnapshotFile: (filepath) => Promise.resolve(snapshots.get(filepath) ?? null),
  removeSnapshotFile: (filepath) => {
    snapshots.delete(filepath)
    return Promise.resolve()
  },
})

const readRunnerModule = (value: Record<string, unknown>): RunnerModule => {
  if (typeof value.startTests !== 'function') {
    throw new TypeError("esm.sh's @vitest/runner module does not export startTests")
  }
  return value as unknown as RunnerModule
}

const readVitestModule = (value: Record<string, unknown>): VitestModule => {
  if (typeof value.TestRunner !== 'function') {
    throw new TypeError("esm.sh's vitest module does not export TestRunner")
  }
  return value as unknown as VitestModule
}

const importUrl = async (url: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ url)) as Record<string, unknown>

const normalizeFiles = (value: unknown): VitestFileResult[] => {
  if (!Array.isArray(value)) {
    throw new TypeError('Vitest startTests returned a non-array result')
  }
  return value.map((file) => normalizeFile(asTask(file)))
}

const normalizeFile = (file: RuntimeFile): VitestFileResult => {
  const filepath = readString(file.filepath) ?? readString(file.name) ?? '<unknown>'
  const tests: VitestTestResult[] = []
  collectTests(readTasks(file.tasks), filepath, [], tests)
  const errors = normalizeErrors(file.result?.errors)
  const failed = file.result?.state === 'fail' || errors.length > 0 || tests.some((test) => test.status === 'fail')
  return {
    filepath,
    status: failed ? 'fail' : 'pass',
    durationMs: readDuration(file.result?.duration),
    errors,
    tests,
  }
}

const collectTests = (
  tasks: readonly RuntimeTask[],
  filepath: string,
  parents: readonly string[],
  output: VitestTestResult[],
): void => {
  for (const task of tasks) {
    const name = readString(task.name) ?? '<unnamed>'
    const ancestry = [...parents, name]
    if (task.type === 'test') {
      output.push({
        id: readString(task.id) ?? `${filepath}:${ancestry.join(' > ')}`,
        name,
        fullName: ancestry.join(' > '),
        filepath,
        status: normalizeStatus(task),
        durationMs: readDuration(task.result?.duration),
        errors: normalizeErrors(task.result?.errors),
      })
    }
    collectTests(readTasks(task.tasks), filepath, ancestry, output)
  }
}

const normalizeStatus = (task: RuntimeTask): VitestTestStatus => {
  if (task.mode === 'todo') return 'todo'
  if (task.mode === 'skip' || task.result?.state === 'skip') return 'skip'
  return task.result?.state === 'fail' ? 'fail' : 'pass'
}

const normalizeErrors = (value: unknown): VitestSerializedError[] => {
  if (!Array.isArray(value)) return []
  return value.map(serializeError)
}

const serializeError = (error: unknown): VitestSerializedError => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    const name = readString(record.name) ?? 'Error'
    const message = readString(record.message) ?? String(error)
    const stack = readString(record.stack)
    return { name, message, ...(stack === undefined ? {} : { stack }) }
  }
  return { name: 'NonError', message: typeof error === 'string' ? error : String(error) }
}

const asTask = (value: unknown): RuntimeFile => {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Vitest returned an invalid file task')
  }
  return value as RuntimeFile
}

const readTasks = (value: unknown): RuntimeTask[] => (Array.isArray(value) ? value.map(asTask) : [])

const readString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const readDuration = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : 0

const runCleanups = async (cleanups: readonly (() => unknown)[]): Promise<void> => {
  for (const cleanup of cleanups) {
    await cleanup()
  }
}

const elapsedMs = (startedAt: number): number => Math.round((performance.now() - startedAt) * 100) / 100
