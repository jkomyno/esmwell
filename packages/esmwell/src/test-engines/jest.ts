const ESM_SH_ORIGIN = 'https://esm.sh'
const JEST_CIRCUS_LATEST_PROBE_URL = `${ESM_SH_ORIGIN}/jest-circus@latest`

interface TestFunction {
  (name: string, implementation?: (...args: readonly unknown[]) => unknown, timeout?: number): void
  readonly concurrent: TestFunction
  readonly only: TestFunction
  readonly skip: TestFunction
  readonly todo: (name: string) => void
}

interface DescribeFunction {
  (name: string, definition: () => void): void
  readonly only: DescribeFunction
  readonly skip: DescribeFunction
}

type HookFunction = (implementation: (...args: readonly unknown[]) => unknown, timeout?: number) => void

interface JestMatchers {
  readonly not: JestMatchers
  readonly rejects: JestMatchers
  readonly resolves: JestMatchers
  readonly toBe: (expected: unknown) => void
  readonly toEqual: (expected: unknown) => void
  readonly toHaveBeenCalled: () => void
  readonly toHaveBeenCalledWith: (...expected: readonly unknown[]) => void
  readonly toMatch: (expected: unknown) => void
  readonly toStrictEqual: (expected: unknown) => void
  readonly toThrow: (expected?: unknown) => void
}

interface JestExpect {
  (actual: unknown): JestMatchers
  readonly assertions: (count: number) => void
  readonly hasAssertions: () => void
}

interface CircusTestResult {
  readonly duration: number | null
  readonly errors: readonly string[]
  readonly errorsDetailed?: readonly unknown[]
  readonly status: 'done' | 'skip' | 'todo'
  readonly testPath: readonly string[]
}

interface CircusRunResult {
  readonly testResults: readonly CircusTestResult[]
  readonly unhandledErrors: readonly string[]
}

interface CircusModule {
  readonly afterAll: HookFunction
  readonly afterEach: HookFunction
  readonly beforeAll: HookFunction
  readonly beforeEach: HookFunction
  readonly describe: DescribeFunction
  readonly it: TestFunction
  readonly resetState: () => void
  readonly run: () => Promise<CircusRunResult>
  readonly test: TestFunction
}

interface ExpectModule {
  readonly expect: JestTestGlobals['expect']
}

interface JestMockModule {
  readonly fn: (...args: readonly unknown[]) => unknown
  readonly mocked: (...args: readonly unknown[]) => unknown
  readonly replaceProperty: (...args: readonly unknown[]) => unknown
  readonly spyOn: (...args: readonly unknown[]) => unknown
}

export interface JestTestGlobals {
  readonly afterAll: HookFunction
  readonly afterEach: HookFunction
  readonly beforeAll: HookFunction
  readonly beforeEach: HookFunction
  readonly describe: DescribeFunction
  readonly expect: JestExpect
  readonly it: TestFunction
  readonly jest: JestMockModule
  readonly test: TestFunction
}

export interface JestEngineError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

export type JestTestStatus = 'passed' | 'failed' | 'skipped' | 'todo'

export interface JestTestResult {
  readonly durationMs: number | null
  readonly errors: readonly JestEngineError[]
  readonly fullName: string
  readonly name: string
  readonly path: readonly string[]
  readonly status: JestTestStatus
}

export interface JestBrowserRunResult {
  readonly error?: JestEngineError
  readonly ok: boolean
  readonly runner: {
    readonly name: 'jest-circus'
    readonly requestedVersion: 'latest'
    readonly resolvedVersion: string
  }
  readonly tests: readonly JestTestResult[]
  readonly unhandledErrors: readonly JestEngineError[]
}

export type ImportJestTestFile = (globals: JestTestGlobals) => Promise<void>

interface ResolvedJestEngine {
  readonly circus: CircusModule
  readonly expect: ExpectModule
  readonly mock: JestMockModule
  readonly version: string
}

const parseVersion = (modulePath: string): string => {
  const match = /^\/jest-circus@([^/]+)\//.exec(modulePath)
  if (match?.[1] === undefined) {
    throw new Error(`esm.sh returned an unexpected Jest module path: ${modulePath}`)
  }
  return match[1]
}

const resolveLatestJestVersion = async (): Promise<string> => {
  // HEAD only reads the version header; GET would download a discarded bundle.
  const response = await fetch(JEST_CIRCUS_LATEST_PROBE_URL, { method: 'HEAD' })
  if (!response.ok) {
    throw new Error(`could not resolve the latest Jest version from esm.sh (${response.status})`)
  }
  const modulePath = response.headers.get('x-esm-path')
  if (modulePath === null) {
    throw new Error('esm.sh did not report the resolved Jest module path')
  }
  return parseVersion(modulePath)
}

const importEngineModule = async <Module>(specifier: string): Promise<Module> =>
  import(/* @vite-ignore */ specifier) as Promise<Module>

const loadJestEngine = async (): Promise<ResolvedJestEngine> => {
  const version = await resolveLatestJestVersion()
  const query = '?bundle&target=es2022'
  const [circus, expect, mock] = await Promise.all([
    importEngineModule<CircusModule>(`${ESM_SH_ORIGIN}/jest-circus@${version}${query}`),
    importEngineModule<ExpectModule>(`${ESM_SH_ORIGIN}/expect@${version}${query}`),
    importEngineModule<JestMockModule>(`${ESM_SH_ORIGIN}/jest-mock@${version}${query}`),
  ])
  return { circus, expect, mock, version }
}

const serializeError = (value: unknown): JestEngineError => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack === undefined ? {} : { stack: value.stack }),
    }
  }
  return { name: 'Error', message: String(value) }
}

const normalizedTestPath = (testPath: readonly string[]): readonly string[] =>
  testPath[0] === 'ROOT_DESCRIBE_BLOCK' ? testPath.slice(1) : testPath

const normalizeTestResult = (result: CircusTestResult): JestTestResult => {
  const path = normalizedTestPath(result.testPath)
  const errors = (result.errorsDetailed ?? result.errors).map(serializeError)
  const status: JestTestStatus =
    result.status === 'skip' ? 'skipped' : result.status === 'todo' ? 'todo' : errors.length === 0 ? 'passed' : 'failed'
  return {
    durationMs: result.duration,
    errors,
    fullName: path.join(' '),
    name: path.at(-1) ?? '',
    path,
    status,
  }
}

/**
 * Runs ESM test modules with Jest's published Circus, expect, and mock packages.
 *
 * The callback owns test-module loading so the surrounding worker can resolve
 * virtual workspace imports and expose these globals through `@jest/globals`.
 */
export const runJestTests = async (importTestFile: ImportJestTestFile): Promise<JestBrowserRunResult> => {
  let resolvedVersion = 'unknown'
  try {
    const engine = await loadJestEngine()
    resolvedVersion = engine.version
    engine.circus.resetState()

    const globals: JestTestGlobals = {
      afterAll: engine.circus.afterAll,
      afterEach: engine.circus.afterEach,
      beforeAll: engine.circus.beforeAll,
      beforeEach: engine.circus.beforeEach,
      describe: engine.circus.describe,
      expect: engine.expect.expect,
      it: engine.circus.it,
      jest: engine.mock,
      test: engine.circus.test,
    }

    await importTestFile(globals)
    const result = await engine.circus.run()
    const tests = result.testResults.map(normalizeTestResult)
    const unhandledErrors = result.unhandledErrors.map(serializeError)
    return {
      ok: tests.every((test) => test.status !== 'failed') && unhandledErrors.length === 0,
      runner: { name: 'jest-circus', requestedVersion: 'latest', resolvedVersion },
      tests,
      unhandledErrors,
    }
  } catch (error) {
    return {
      error: serializeError(error),
      ok: false,
      runner: { name: 'jest-circus', requestedVersion: 'latest', resolvedVersion },
      tests: [],
      unhandledErrors: [],
    }
  }
}
