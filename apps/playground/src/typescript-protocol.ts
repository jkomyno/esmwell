export type SourceLanguage = 'ts' | 'mjs'

export interface TypeScriptDiagnostic {
  readonly category: 'error' | 'warning'
  readonly code: number
  readonly message: string
  readonly start: number
  readonly length: number
  readonly line: number
  readonly column: number
}

export interface TypeScriptCompletion {
  readonly label: string
  readonly type: string
  readonly detail: string
  readonly apply?: string
}

export interface TypeScriptCompletions {
  readonly from: number
  readonly options: readonly TypeScriptCompletion[]
}

export type TypeScriptWorkerRequestBody =
  | {
      readonly type: 'completions'
      readonly source: string
      readonly language: SourceLanguage
      readonly position: number
    }
  | {
      readonly type: 'diagnostics'
      readonly source: string
      readonly language: SourceLanguage
    }
  | {
      readonly type: 'transpile'
      readonly source: string
    }

export type TypeScriptWorkerRequest = TypeScriptWorkerRequestBody & { readonly requestId: number }

export type TypeScriptWorkerResponse =
  | { readonly type: 'result'; readonly requestId: number; readonly result: unknown }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string }
