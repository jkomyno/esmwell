import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { Diagnostic } from '@codemirror/lint'
import type {
  SourceLanguage,
  TypeScriptCompletions,
  TypeScriptDiagnostic,
  TypeScriptQuickInfo,
  TypeScriptWorkerRequest,
  TypeScriptWorkerRequestBody,
  TypeScriptWorkerResponse,
} from './typescript-protocol'

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

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

export class TypeScriptClient {
  #worker: Worker | undefined
  #postToWorker: ((message: TypeScriptWorkerRequest) => void) | undefined
  readonly #pending = new Map<number, PendingRequest>()
  #transpileCache: { readonly source: string; readonly promise: Promise<string> } | undefined
  #requestId = 0
  #destroyed = false

  constructor() {
    this.#startWorker()
  }

  #startWorker(): void {
    if (this.#destroyed) {
      throw new Error('TypeScript worker terminated')
    }
    if (this.#worker !== undefined) {
      return
    }
    const worker = new Worker(new URL('./typescript-worker.ts', import.meta.url), { type: 'module' })
    this.#worker = worker
    this.#postToWorker = worker.postMessage.bind(worker)
    worker.addEventListener('message', (event: MessageEvent<TypeScriptWorkerResponse>) => {
      if (worker !== this.#worker) {
        return
      }
      const response = event.data
      const pending = this.#pending.get(response.requestId)
      if (pending === undefined) {
        return
      }
      this.#pending.delete(response.requestId)
      if (response.type === 'error') {
        pending.reject(new Error(response.message))
      } else {
        pending.resolve(response.result)
      }
    })
    worker.addEventListener('error', (event) => {
      if (worker === this.#worker) {
        this.#retireWorker(worker, event.message || 'TypeScript worker failed')
      }
    })
  }

  transpile(source: string): Promise<string> {
    if (this.#transpileCache?.source === source) {
      return this.#transpileCache.promise
    }
    const promise = this.#request<{ code: string; diagnostics: readonly TypeScriptDiagnostic[] }>({
      type: 'transpile',
      source,
    }).then((result) => {
      const error = result.diagnostics.find((diagnostic) => diagnostic.category === 'error')
      if (error !== undefined) {
        throw new TypeScriptCompileError(error)
      }
      return result.code
    })
    this.#transpileCache = { source, promise }
    return promise
  }

  async diagnostics(source: string, language: SourceLanguage): Promise<readonly Diagnostic[]> {
    const diagnostics = await this.#request<readonly TypeScriptDiagnostic[]>({ type: 'diagnostics', source, language })
    return diagnostics.map((diagnostic) => ({
      from: Math.min(Math.max(diagnostic.start, 0), source.length),
      to: Math.min(Math.max(diagnostic.start + diagnostic.length, diagnostic.start + 1), source.length),
      severity: diagnostic.category,
      message: diagnostic.message,
      source: `TypeScript ${diagnostic.code}`,
    }))
  }

  quickInfo(source: string, language: SourceLanguage, position: number): Promise<TypeScriptQuickInfo | null> {
    return this.#request({ type: 'quick-info', source, language, position })
  }

  /** Downloads the module's declarations and type-checks it once, ahead of the first hover. */
  async warm(source: string, language: SourceLanguage): Promise<void> {
    await this.#request<null>({ type: 'warm', source, language })
  }

  completionSource(documentContext: () => CompletionDocument): CompletionSource {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const document = context.state.doc.toString()
      const { prefix, language } = documentContext()
      const source = `${prefix}${document}`
      const position = prefix.length + context.pos
      const result = await this.#request<TypeScriptCompletions | null>({
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
    if (this.#destroyed) {
      return
    }
    this.#destroyed = true
    const worker = this.#worker
    if (worker === undefined) {
      this.#fail('TypeScript worker terminated')
    } else {
      this.#retireWorker(worker, 'TypeScript worker terminated')
    }
  }

  #request<Result>(body: TypeScriptWorkerRequestBody): Promise<Result> {
    if (this.#destroyed) {
      return Promise.reject(new Error('TypeScript worker terminated'))
    }
    try {
      this.#startWorker()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const worker = this.#worker
    const postToWorker = this.#postToWorker
    if (worker === undefined || postToWorker === undefined) {
      return Promise.reject(new Error('TypeScript worker failed to start'))
    }
    const requestId = ++this.#requestId
    return new Promise<Result>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      try {
        postToWorker({ ...body, requestId } satisfies TypeScriptWorkerRequest)
      } catch (error) {
        this.#retireWorker(worker, error instanceof Error ? error.message : String(error))
      }
    })
  }

  #retireWorker(worker: Worker, message: string): void {
    worker.terminate()
    if (worker === this.#worker) {
      this.#worker = undefined
      this.#postToWorker = undefined
      this.#transpileCache = undefined
      this.#fail(message)
    }
  }

  #fail(message: string): void {
    for (const pending of this.#pending.values()) {
      pending.reject(new Error(message))
    }
    this.#pending.clear()
  }
}
