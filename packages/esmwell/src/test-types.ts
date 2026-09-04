import type { ConsoleChunk, SerializedError } from './types'
import type { ResolvedDependency } from './resolve'

/** Upstream test engine used for one workspace run. */
export type TestEngineName = 'vitest' | 'jest'

/** Canonical ESM module id to JavaScript source. */
export type TestModules = Readonly<Record<string, string>>

/** One test workspace submitted to the browser worker. */
export interface TestRun {
  readonly engine: TestEngineName
  readonly modules: TestModules
  /** Canonical ids from `modules` to import as test entries, in order. */
  readonly testFiles: readonly string[]
}

/** Status shared by normalized Vitest and Jest test cases. */
export type TestCaseStatus = 'pass' | 'fail' | 'skip' | 'todo'

/** One normalized test case reported by an upstream engine. */
export interface TestCaseResult {
  readonly id: string
  readonly name: string
  readonly fullName: string
  readonly status: TestCaseStatus
  readonly durationMs: number
  readonly errors: readonly SerializedError[]
}

/** The exact upstream package selected for an engine component. */
export interface TestEnginePackage {
  readonly name: string
  readonly version: string
  readonly url: string
}

/** Upstream engine identity and the official packages used for the run. */
export interface TestEngineInfo {
  readonly name: TestEngineName
  readonly version: string
  readonly packages: readonly TestEnginePackage[]
}

/** Overall status for a test workspace run. */
export type TestRunStatus = 'pass' | 'fail' | 'error'

/** Serializable result shared by Vitest and Jest workspace runs. */
export interface TestRunResult {
  readonly status: TestRunStatus
  readonly ok: boolean
  readonly engine?: TestEngineInfo
  readonly tests: readonly TestCaseResult[]
  readonly console: readonly ConsoleChunk[]
  readonly dependencies: readonly ResolvedDependency[]
  readonly error?: SerializedError
  readonly durationMs: number
}
