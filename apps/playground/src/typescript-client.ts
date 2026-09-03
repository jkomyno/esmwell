import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { Diagnostic } from '@codemirror/lint'
import { createWorkerRpc, type WorkerRpc } from 'esmwell/utils'
import type {
  SourceLanguage,
  TypeScriptCompletions,
  TypeScriptDiagnostic,
  TypeScriptQuickInfo,
  TypeScriptWorkerRequest,
} from './typescript-protocol'

export class TypeScriptCompileError extends Error {
  readonly line: number
  readonly column: number

  constructor(diagnostic: TypeScriptDiagnostic) {
    super(`TS${diagnostic.code}: ${diagnostic.message}`)
    this.name = 'TypeScriptError'
    this.line = diagnostic.line
    this.column = diagnostic.column
  }
}

export interface CompletionDocument {
  readonly prefix: string
  readonly language: SourceLanguage
}

/**
 * The page side of the TypeScript language-service worker. esmwell's worker
 * rpc owns the request pairing and the worker's lifecycle; this class only
 * shapes each request and adapts the answers to CodeMirror.
 */
export class TypeScriptClient {
  readonly #rpc: WorkerRpc<TypeScriptWorkerRequest>
  #transpileCache: { readonly source: string; readonly promise: Promise<string> } | undefined

  constructor() {
    this.#rpc = createWorkerRpc<TypeScriptWorkerRequest>({
      createWorker: () => new Worker(new URL('./typescript-worker.ts', import.meta.url), { type: 'module' }),
    })
  }

  transpile(source: string): Promise<string> {
    if (this.#transpileCache?.source === source) {
      return this.#transpileCache.promise
    }
    const promise = this.#rpc
      .request<{ code: string; diagnostics: readonly TypeScriptDiagnostic[] }>({ type: 'transpile', source })
      .then((result) => {
        const error = result.diagnostics.find((diagnostic) => diagnostic.category === 'error')
        if (error !== undefined) {
          throw new TypeScriptCompileError(error)
        }
        return result.code
      })
    promise.catch(() => {
      if (this.#transpileCache?.promise === promise) {
        this.#transpileCache = undefined
      }
    })
    this.#transpileCache = { source, promise }
    return promise
  }

  async diagnostics(source: string, language: SourceLanguage): Promise<readonly Diagnostic[]> {
    const diagnostics = await this.#rpc.request<readonly TypeScriptDiagnostic[]>({
      type: 'diagnostics',
      source,
      language,
    })
    return diagnostics.map((diagnostic) => ({
      from: Math.min(Math.max(diagnostic.start, 0), source.length),
      to: Math.min(Math.max(diagnostic.start + diagnostic.length, diagnostic.start + 1), source.length),
      severity: diagnostic.category,
      message: diagnostic.message,
      source: `TypeScript ${diagnostic.code}`,
    }))
  }

  quickInfo(source: string, language: SourceLanguage, position: number): Promise<TypeScriptQuickInfo | null> {
    return this.#rpc.request<TypeScriptQuickInfo | null>({ type: 'quick-info', source, language, position })
  }

  /** Downloads the module's declarations and type-checks it once, ahead of the first hover. */
  async warm(source: string, language: SourceLanguage): Promise<void> {
    await this.#rpc.request<null>({ type: 'warm', source, language })
  }

  completionSource(documentContext: () => CompletionDocument): CompletionSource {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const document = context.state.doc.toString()
      const { prefix, language } = documentContext()
      const source = `${prefix}${document}`
      const position = prefix.length + context.pos
      const result = await this.#rpc.request<TypeScriptCompletions | null>({
        type: 'completions',
        source,
        language,
        position,
      })
      if (result === null) {
        return null
      }
      return {
        from: Math.min(Math.max(result.from - prefix.length, 0), context.pos),
        options: result.options.map(
          (option): Completion => ({
            label: option.label,
            type: option.type,
            detail: option.detail,
            ...(option.apply === undefined ? {} : { apply: option.apply }),
          }),
        ),
        validFor: /^[\p{L}\p{N}_$]*$/u,
      }
    }
  }

  destroy(): void {
    this.#rpc.destroy()
  }
}
