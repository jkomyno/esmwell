/**
 * A `transform` that compiles TypeScript to the ESM the runner executes, on
 * top of a `typescript` module the host supplies. runesm never imports the
 * compiler itself: the host proves it is installed by handing over the
 * import, so a bundler with no `typescript` package still builds, and the
 * `.ts` path is simply unavailable at runtime.
 */
import type { SourceTransform, SourceTransformContext } from './transform'

/**
 * The slice of the `typescript` module API the transform uses. Structural on
 * purpose, so a host can pass `import('typescript')`, a worker-side handle,
 * or a stub in tests without depending on the compiler's own declarations.
 */
export interface TypeScriptCompiler {
  transpileModule(input: string, options: TypeScriptTranspileOptions): TypeScriptTranspileOutput
  /** Turns a diagnostic's message chain into one string. */
  flattenDiagnosticMessageText(messageText: unknown, newLine: string): string
  readonly ModuleKind: { readonly ESNext: number }
  readonly ScriptTarget: { readonly ES2023?: number; readonly ESNext: number }
  readonly DiagnosticCategory: { readonly Error: number }
}

export interface TypeScriptTranspileOptions {
  readonly compilerOptions: Readonly<Record<string, unknown>>
  readonly fileName: string
  readonly reportDiagnostics: boolean
}

export interface TypeScriptTranspileOutput {
  readonly outputText: string
  readonly diagnostics?: readonly TypeScriptDiagnosticLike[]
}

/** A `ts.Diagnostic` as far as the transform reads it. */
export interface TypeScriptDiagnosticLike {
  readonly category: number
  readonly code: number
  readonly messageText: unknown
  readonly start?: number
  readonly file?: {
    getLineAndCharacterOfPosition(position: number): { readonly line: number; readonly character: number }
  }
}

export interface TypeScriptTransformOptions {
  /**
   * Supplies the compiler, typically `() => import('typescript')`. Both a
   * module namespace (with the API under `default`) and the API object itself
   * are accepted. The result is cached after the first successful load; a
   * failed load is retried on the next run.
   */
  readonly load: () => Promise<unknown> | unknown
  /**
   * Compiler options merged over the transform's defaults: `module: ESNext`,
   * `target: ES2023`, `verbatimModuleSyntax: true`, and no source maps.
   */
  readonly compilerOptions?: Readonly<Record<string, unknown>>
  /** File name reported in diagnostics (default `/module.ts`). */
  readonly fileName?: string
}

/** Thrown when `load` does not yield a usable `typescript` module. */
export class TypeScriptUnavailableError extends Error {
  override readonly name = 'TypeScriptUnavailableError'

  constructor(cause: unknown) {
    super(
      "TypeScript is not available: install the `typescript` package and pass `load: () => import('typescript')` to typescriptTransform, or submit JavaScript instead",
      { cause },
    )
  }
}

/** A compile-blocking syntax diagnostic from `transpileModule`. */
export class TypeScriptSyntaxError extends SyntaxError {
  override readonly name = 'TypeScriptError'
  /** The `TSxxxx` diagnostic code. */
  readonly code: number
  /** 1-based line of the diagnostic, when it has a position. */
  readonly line: number | undefined
  /** 0-based column of the diagnostic, when it has a position. */
  readonly column: number | undefined

  constructor(code: number, message: string, position: { line: number; column: number } | undefined) {
    super(`TS${code}: ${message}`)
    this.code = code
    this.line = position?.line
    this.column = position?.column
  }
}

const isCompiler = (value: unknown): value is TypeScriptCompiler =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { transpileModule?: unknown }).transpileModule === 'function' &&
  typeof (value as { flattenDiagnosticMessageText?: unknown }).flattenDiagnosticMessageText === 'function'

/** Accepts the API object or a module namespace that carries it as `default`. */
const unwrapCompiler = (loaded: unknown): TypeScriptCompiler => {
  if (isCompiler(loaded)) {
    return loaded
  }
  const namespaceDefault = (loaded as { default?: unknown } | null)?.default
  if (isCompiler(namespaceDefault)) {
    return namespaceDefault
  }
  throw new TypeScriptUnavailableError(new TypeError('the loaded module does not expose transpileModule'))
}

const DEFAULT_FILE_NAME = '/module.ts'

const defaultCompilerOptions = (ts: TypeScriptCompiler): Record<string, unknown> => ({
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2023 ?? ts.ScriptTarget.ESNext,
  verbatimModuleSyntax: true,
  sourceMap: false,
  inlineSourceMap: false,
})

const diagnosticPosition = (diagnostic: TypeScriptDiagnosticLike): { line: number; column: number } | undefined => {
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return undefined
  }
  const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return { line: location.line + 1, column: location.character }
}

/**
 * Creates a session `transform` that strips types and compiles TypeScript
 * syntax with `ts.transpileModule`: single-file, no type checking, no lib
 * files to ship. Type errors do not block a run; syntax errors surface as a
 * `TypeScriptError` result with the diagnostic's line and column.
 *
 * ```ts
 * import { createRunesm } from 'runesm'
 * import { typescriptTransform } from 'runesm/typescript'
 *
 * const session = createRunesm({
 *   transform: typescriptTransform({ load: () => import('typescript') }),
 * })
 * ```
 */
export function typescriptTransform(options: TypeScriptTransformOptions): SourceTransform {
  const fileName = options.fileName ?? DEFAULT_FILE_NAME
  let compiler: Promise<TypeScriptCompiler> | undefined

  const loadCompiler = (): Promise<TypeScriptCompiler> => {
    if (compiler === undefined) {
      compiler = Promise.resolve()
        .then(() => options.load())
        .then(unwrapCompiler, (error: unknown) => {
          throw error instanceof TypeScriptUnavailableError ? error : new TypeScriptUnavailableError(error)
        })
      compiler.catch(() => {
        compiler = undefined
      })
    }
    return compiler
  }

  return async (source: string, _context: SourceTransformContext): Promise<string> => {
    const ts = await loadCompiler()
    const output = ts.transpileModule(source, {
      compilerOptions: { ...defaultCompilerOptions(ts), ...options.compilerOptions },
      fileName,
      reportDiagnostics: true,
    })
    const blocking = output.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    if (blocking !== undefined) {
      throw new TypeScriptSyntaxError(
        blocking.code,
        ts.flattenDiagnosticMessageText(blocking.messageText, '\n'),
        diagnosticPosition(blocking),
      )
    }
    return output.outputText
  }
}
