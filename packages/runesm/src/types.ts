import type { ResolvedDependency } from './resolve'

/** A single judge-mode test case: one invocation of one named export. */
export interface JudgeCase {
  /** Display name for the result. */
  readonly name: string
  /** The named export to invoke. */
  readonly exportName: string
  /** Arguments to invoke the export with. Defaults to none. */
  readonly args?: readonly unknown[]
  /** Expected return value, compared with structural deep equality. */
  readonly expected?: unknown
}

/** Per-case outcome. */
export type JudgeCaseStatus = 'pass' | 'fail' | 'error'

/** An error crossing the transport boundary, message plus stack when present. */
export interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

/** Result of invoking one case's export. */
export interface JudgeCaseResult {
  readonly name: string
  readonly exportName: string
  readonly status: JudgeCaseStatus
  /** Actual return value, present when the case was compared. */
  readonly actual?: unknown
  /** Expected value, present when the case was compared. */
  readonly expected?: unknown
  /** Present when the case errored. */
  readonly error?: SerializedError
  readonly durationMs: number
}

/** Console methods the capture intercepts. */
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/** One captured console call, arguments pre-serialized. */
export interface ConsoleChunk {
  readonly level: ConsoleLevel
  readonly parts: readonly string[]
}

/** Overall judge-run outcome. */
export type JudgeRunStatus = 'pass' | 'fail' | 'error'

/** The full result of one judge run. */
export interface JudgeRunResult {
  readonly status: JudgeRunStatus
  /** True when the module loaded and every case passed. */
  readonly ok: boolean
  readonly cases: readonly JudgeCaseResult[]
  /** Console output captured during the run, in order. */
  readonly console: readonly ConsoleChunk[]
  /** Module-level error (syntax, policy, resolution, or evaluation). */
  readonly error?: SerializedError
  /** Dependencies the module's bare imports resolved to. */
  readonly dependencies: readonly ResolvedDependency[]
  readonly durationMs: number
}

/** Main-thread → worker request: run user code as a judged module. */
export interface JudgeRequest {
  readonly kind: 'judge'
  /** Pairing id; responses echo it. */
  readonly id: number
  readonly code: string
  readonly cases: readonly JudgeCase[]
  readonly deps?: Readonly<Record<string, string>>
  readonly autoInstall?: boolean
}

export type WorkerRequest = JudgeRequest

export type WorkerResponse =
  | { readonly kind: 'console'; readonly id: number; readonly chunk: ConsoleChunk }
  | { readonly kind: 'result'; readonly id: number; readonly result: JudgeRunResult }
