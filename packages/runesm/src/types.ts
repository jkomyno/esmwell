import type { PolicyRule } from './policy'
import type { ResolutionFailureKind, ResolvedDependency } from './resolve'
import type { TestRun, TestRunResult } from './test-types'

/** A single judge-mode test case: one invocation of one named export. */
export interface JudgeCase {
  /** Display name for the result. */
  readonly name: string
  /** The named export to invoke. */
  readonly exportName: string
  /** Arguments to invoke the export with. Defaults to none. */
  readonly args?: readonly unknown[]
  /**
   * Expected return value, compared with structural deep equality.
   *
   * Omitting this field entirely means "pass if the export does not throw";
   * the return value is not inspected. Setting it explicitly to `undefined`
   * is a real expectation — the export must resolve to `undefined` — and is
   * checked like any other value. These are different outcomes: a case built
   * with `{ ...base, expected: undefined }` asserts the return value, it does
   * not fall back to "no expectation". Omit the key (rather than setting it
   * to `undefined`) when the return value should be ignored.
   */
  readonly expected?: unknown
}

/** Per-case outcome. */
export type JudgeCaseStatus = 'pass' | 'fail' | 'error'

/**
 * An error crossing the transport boundary, message plus stack when present.
 * `name` is the reliable discriminator. The remaining fields are only present
 * when the source error was one of this package's structured error classes:
 * `rule`/`line` come from `PolicyViolation`, `line`/`column` from
 * `UserSyntaxError`, and `kind`/`specifier` from `SpecifierResolutionError`.
 */
export interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stack?: string
  /** Present for a `PolicyViolation`: the rule that fired. */
  readonly rule?: PolicyRule
  /** 1-based. Present for a `PolicyViolation` or a `UserSyntaxError`. */
  readonly line?: number
  /** Present for a `UserSyntaxError`: 0-based column. */
  readonly column?: number
  /** Present for a `SpecifierResolutionError`: why the specifier failed. */
  readonly kind?: ResolutionFailureKind
  /** Present for a `SpecifierResolutionError`: the specifier that failed. */
  readonly specifier?: string
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

/** The outcome of one REPL evaluation. */
export interface ReplResult {
  readonly ok: boolean
  /** Completion value: the input's final expression, when present. */
  readonly value?: unknown
  /** Present when the evaluation failed (syntax, policy, resolution, or runtime). */
  readonly error?: SerializedError
  readonly console: readonly ConsoleChunk[]
  readonly dependencies: readonly ResolvedDependency[]
  readonly durationMs: number
}

/** Main-thread → worker request: evaluate one REPL input. */
export interface ReplInputRequest {
  readonly kind: 'repl-input'
  readonly id: number
  readonly input: string
  readonly deps?: Readonly<Record<string, string>>
  readonly autoInstall?: boolean
}

/** Main-thread → worker request: start a fresh REPL scope. */
export interface ReplResetRequest {
  readonly kind: 'repl-reset'
  readonly id: number
}

/** Main-thread → worker request: run a virtual ESM test workspace. */
export interface TestRequest {
  readonly kind: 'test'
  readonly id: number
  readonly run: TestRun
  readonly graphId: string
  readonly serviceWorkerScope: string
  readonly deps?: Readonly<Record<string, string>>
  readonly autoInstall?: boolean
}

export type WorkerRequest = JudgeRequest | ReplInputRequest | ReplResetRequest | TestRequest

export type WorkerResponse =
  | { readonly kind: 'console'; readonly id: number; readonly chunk: ConsoleChunk }
  | { readonly kind: 'result'; readonly id: number; readonly result: JudgeRunResult }
  | { readonly kind: 'repl-result'; readonly id: number; readonly result: ReplResult }
  | { readonly kind: 'repl-ack'; readonly id: number }
  | { readonly kind: 'test-result'; readonly id: number; readonly result: TestRunResult }
