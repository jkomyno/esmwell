import { installConsoleCapture } from './console'
import { deepEqual } from './deep-equal'
import { createDataModuleUrl, createModuleUrl, importModule, readNamedExport } from './loader'
import type { ModuleNamespace } from './loader'
import { parseUserModule, UserSyntaxError } from './parse'
import { checkPolicy, PolicyViolation } from './policy'
import { SpecifierResolutionError } from './resolve'
import type { ResolveOptions } from './resolve'
import type { ResolvedDependency } from './resolve'
import { transformJudgeModule } from './transform-judge'
import { RESULT_EXPORT, transformReplInput } from './transform-repl'
import type { ConsoleChunk, JudgeCase, JudgeCaseResult, JudgeRunResult, ReplResult, SerializedError } from './types'

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
  let dependencies: ResolvedDependency[] = []

  try {
    const ast = parseUserModule(code)
    const violations = checkPolicy(ast)
    const firstViolation = violations[0]
    if (firstViolation !== undefined) {
      throw firstViolation
    }
    const transformed = transformJudgeModule(code, ast, options)
    dependencies = transformed.dependencies
    const rewritten = transformed.code
    moduleUrl = createModuleUrl(rewritten)
    const module = await importSubmittedModule(moduleUrl, dependencies)

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
      dependencies,
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
    const base: SerializedError = {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    }
    if (error instanceof PolicyViolation) {
      return { ...base, rule: error.rule, line: error.line }
    }
    if (error instanceof SpecifierResolutionError) {
      return { ...base, kind: error.kind, specifier: error.specifier }
    }
    if (error instanceof UserSyntaxError) {
      return { ...base, line: error.line, column: error.column }
    }
    return base
  }
  return {
    name: 'NonError',
    message: typeof error === 'string' ? error : String(error),
  }
}

/** A browser-level module fetch failure with the submitted packages restored as context. */
class DependencyLoadError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'DependencyLoadError'
  }
}

const OPAQUE_MODULE_LOAD_MESSAGES = [
  /importing a module script failed/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /failed to load module script/i,
]

/**
 * Browser engines often hide a failed module graph behind a context-free
 * TypeError. Restore the top-level packages and explain the browser/native
 * boundary without claiming which transitive request failed.
 */
export const explainModuleLoadError = (error: unknown, dependencies: readonly ResolvedDependency[]): unknown => {
  if (!(error instanceof Error) || dependencies.length === 0) {
    return error
  }
  if (!OPAQUE_MODULE_LOAD_MESSAGES.some((pattern) => pattern.test(error.message))) {
    return error
  }

  const packages = dependencies.map((dependency) => `'${dependency.specifier}' (${dependency.url})`).join(', ')
  return new DependencyLoadError(
    `could not load the submitted module's dependency graph in the browser worker; top-level package${dependencies.length === 1 ? '' : 's'}: ${packages}. The browser only reported: ${error.message} This commonly means a package or transitive dependency requires Node-API/native .node bindings or unsupported node:* APIs, esm.sh could not build or serve it, or the network/CSP blocked a module request. Node-API addons cannot run in a browser worker; use a browser/WebAssembly build, or run that package in Node.js or Bun. Check the browser network panel for the exact failed request.`,
    error,
  )
}

const importSubmittedModule = async (
  moduleUrl: string,
  dependencies: readonly ResolvedDependency[],
): Promise<ModuleNamespace> => {
  try {
    return await importModule(moduleUrl)
  } catch (error) {
    throw explainModuleLoadError(error, dependencies)
  }
}

const elapsedMs = (startedAt: number): number => Math.round((performance.now() - startedAt) * 100) / 100

/**
 * The scope object every REPL module in a session shares: a transparent
 * key-value store that falls back to the realm's globals for reads.
 *
 * Receiver-sensitive globals reached through the proxy (e.g. `setTimeout`,
 * `fetch`, `atob`) would otherwise be called with the proxy itself as `this`.
 * These non-prototype callables are wrapped in a Proxy that forces
 * `globalThis` as the call receiver. Prototype-bearing global callables do not
 * need receiver rebinding and are returned untouched, preserving identity for
 * comparisons such as `value.constructor === Array`. The wrapper is memoized
 * in a WeakMap so repeated reads return the identical wrapper. Values already
 * stored on the target — user declarations, imports — are also returned
 * untouched.
 */
const SCOPE_MODULE_SOURCE = `const __runesmScope = {}
const __runesmBoundGlobals = new WeakMap()
export const __runesm = new Proxy(__runesmScope, {
  get(target, key) {
    if (key in target) return target[key]
    if (!(key in globalThis)) throw new ReferenceError(String(key) + ' is not defined')
    const value = globalThis[key]
    // Preserve identity for prototype-bearing global callables, which do not
    // need receiver rebinding. Wrap receiver-sensitive non-prototype callables
    // so WebIDL operations receive the real global object as their receiver.
    if (typeof value !== 'function' || Object.hasOwn(value, 'prototype')) return value
    let bound = __runesmBoundGlobals.get(value)
    if (bound === undefined) {
      bound = new Proxy(value, {
        apply(fn, _thisArg, args) {
          return Reflect.apply(fn, globalThis, args)
        },
        construct(fn, args, newTarget) {
          return Reflect.construct(fn, args, newTarget)
        },
      })
      __runesmBoundGlobals.set(value, bound)
    }
    return bound
  },
  set(target, key, value) {
    target[key] = value
    return true
  },
})
export const __runesmTypeof = new Proxy(__runesmScope, {
  get(target, key) {
    if (key in target) return target[key]
    return globalThis[key]
  },
})
`

/** Handlers for one REPL evaluation. */
export interface ReplEvaluateHandlers {
  /** Console chunks as they stream in, before the result. */
  readonly onConsoleChunk?: (chunk: ConsoleChunk) => void
}

/** An in-realm REPL session: one persistent scope across evaluations. */
export interface ReplRealmSession {
  evaluate(input: string, handlers?: ReplEvaluateHandlers): Promise<ReplResult>
  /** Starts a fresh scope; later evaluations do not see earlier state. */
  reset(): void
}

/**
 * Creates an in-realm REPL session. Each evaluation rewrites its input
 * against the session's shared scope module, so declarations, imports, and
 * reassignments persist across inputs; errors leave the session usable.
 */
let scopeGeneration = 0

/** Scope modules are unique per session (and per reset): module registries cache by URL. */
const createScopeModuleUrl = (): string => {
  scopeGeneration += 1
  return createDataModuleUrl(`${SCOPE_MODULE_SOURCE}\n/* scope ${scopeGeneration} */`)
}

export function createReplSessionInRealm(options: ResolveOptions): ReplRealmSession {
  let scopeModuleUrl = createScopeModuleUrl()
  let generation = 0

  return {
    async evaluate(input: string, handlers?: ReplEvaluateHandlers): Promise<ReplResult> {
      const consoleChunks: ConsoleChunk[] = []
      const restoreConsole = installConsoleCapture({
        write: (chunk) => {
          consoleChunks.push(chunk)
          handlers?.onConsoleChunk?.(chunk)
        },
      })
      const startedAt = performance.now()
      let moduleUrl: string | undefined
      let dependencies: ResolvedDependency[] = []

      try {
        const ast = parseUserModule(input)
        const firstViolation = checkPolicy(ast)[0]
        if (firstViolation !== undefined) {
          throw firstViolation
        }
        const transformed = transformReplInput(input, ast, { ...options, scopeModuleUrl })
        dependencies = transformed.dependencies
        const code = transformed.code
        // Identical input re-evaluated must execute again: module registries
        // cache by URL, so every evaluation gets a unique one.
        generation += 1
        moduleUrl = createModuleUrl(`${code}\n/* evaluation ${generation} */`)
        const module = await importSubmittedModule(moduleUrl, dependencies)
        return {
          ok: true,
          ...(RESULT_EXPORT in module ? { value: module[RESULT_EXPORT] } : {}),
          console: consoleChunks,
          dependencies,
          durationMs: elapsedMs(startedAt),
        }
      } catch (error) {
        return {
          ok: false,
          error: serializeError(error),
          console: consoleChunks,
          dependencies,
          durationMs: elapsedMs(startedAt),
        }
      } finally {
        if (moduleUrl !== undefined && moduleUrl.startsWith('blob:')) {
          URL.revokeObjectURL(moduleUrl)
        }
        restoreConsole()
      }
    },

    reset(): void {
      scopeModuleUrl = createScopeModuleUrl()
    },
  }
}
