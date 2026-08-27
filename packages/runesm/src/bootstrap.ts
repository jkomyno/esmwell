import { installConsoleCapture } from './console'
import { deepEqual } from './deep-equal'
import { importModule, createModuleUrl, readNamedExport } from './loader'
import type { ModuleNamespace } from './loader'
import { parseUserModule } from './parse'
import { checkPolicy } from './policy'
import type { ResolveOptions } from './resolve'
import { transformJudgeModule } from './transform-judge'
import type { ConsoleChunk, JudgeCase, JudgeCaseResult, JudgeRunResult, SerializedError } from './types'

/** Options for one in-realm judge run. */
export interface JudgeRealmOptions extends ResolveOptions {
  readonly cases: readonly JudgeCase[]
  /** Streamed per console call, in addition to being collected in the result. */
  readonly onConsoleChunk?: (chunk: ConsoleChunk) => void
}

/**
 * Runs user code as a judged module in the current realm: parse → policy
 * gate → specifier rewrite → blob/data-URL import → invoke each case's named
 * export → deep-equal against expectations. Console output during the run is
 * captured into the result. Never throws: failures are reported in the
 * result.
 */
export async function runJudgeInRealm(code: string, options: JudgeRealmOptions): Promise<JudgeRunResult> {
  const consoleChunks: ConsoleChunk[] = []
  const restoreConsole = installConsoleCapture({
    write: (chunk) => {
      consoleChunks.push(chunk)
      options.onConsoleChunk?.(chunk)
    },
  })
  const startedAt = performance.now()
  let moduleUrl: string | undefined

  try {
    const ast = parseUserModule(code)
    const violations = checkPolicy(ast)
    const firstViolation = violations[0]
    if (firstViolation !== undefined) {
      throw firstViolation
    }
    const { code: rewritten, dependencies } = transformJudgeModule(code, ast, options)
    moduleUrl = createModuleUrl(rewritten)
    const module = await importModule(moduleUrl)

    const caseResults: JudgeCaseResult[] = []
    for (const testCase of options.cases) {
      caseResults.push(await runJudgeCase(module, testCase))
    }
    const ok = caseResults.every((result) => result.status === 'pass')
    return {
      status: ok ? 'pass' : 'fail',
      ok,
      cases: caseResults,
      console: consoleChunks,
      dependencies,
      durationMs: elapsedMs(startedAt),
    }
  } catch (error) {
    return {
      status: 'error',
      ok: false,
      cases: [],
      console: consoleChunks,
      error: serializeError(error),
      dependencies: [],
      durationMs: elapsedMs(startedAt),
    }
  } finally {
    if (moduleUrl !== undefined && moduleUrl.startsWith('blob:')) {
      URL.revokeObjectURL(moduleUrl)
    }
    restoreConsole()
  }
}

const runJudgeCase = async (module: ModuleNamespace, testCase: JudgeCase): Promise<JudgeCaseResult> => {
  const startedAt = performance.now()
  const { found, value } = readNamedExport(module, testCase.exportName)
  if (!found) {
    return caseError(testCase, startedAt, missingExportError(testCase.exportName, module))
  }
  if (typeof value !== 'function') {
    return caseError(
      testCase,
      startedAt,
      new TypeError(`export '${testCase.exportName}' is not a function — judge cases invoke exports`),
    )
  }

  try {
    const actual = await value(...(testCase.args ?? []))
    if (!('expected' in testCase)) {
      return {
        name: testCase.name,
        exportName: testCase.exportName,
        status: 'pass',
        durationMs: elapsedMs(startedAt),
      }
    }
    const equal = deepEqual(actual, testCase.expected)
    return {
      name: testCase.name,
      exportName: testCase.exportName,
      status: equal ? 'pass' : 'fail',
      ...(equal ? {} : { actual, expected: testCase.expected }),
      durationMs: elapsedMs(startedAt),
    }
  } catch (error) {
    return caseError(testCase, startedAt, error)
  }
}

const caseError = (testCase: JudgeCase, startedAt: number, error: unknown): JudgeCaseResult => ({
  name: testCase.name,
  exportName: testCase.exportName,
  status: 'error',
  error: serializeError(error),
  durationMs: elapsedMs(startedAt),
})

const missingExportError = (exportName: string, module: ModuleNamespace): Error => {
  const available = Object.keys(module).filter((key) => key !== 'default')
  const suffix = available.length > 0 ? ` (available exports: ${available.join(', ')})` : ''
  return new Error(`could not find export '${exportName}' in the submitted module${suffix}`)
}

export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    }
  }
  return {
    name: 'NonError',
    message: typeof error === 'string' ? error : String(error),
  }
}

const elapsedMs = (startedAt: number): number => Math.round((performance.now() - startedAt) * 100) / 100
