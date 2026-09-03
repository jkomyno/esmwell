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

export interface TypeScriptDisplayPart {
  readonly kind: string
  readonly text: string
}

export interface TypeScriptQuickInfo {
  readonly from: number
  readonly to: number
  readonly displayParts: readonly TypeScriptDisplayPart[]
  readonly documentation: string
}

/** One request body; runesm's worker rpc wraps it in its own id envelope. */
export type TypeScriptWorkerRequest =
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
      readonly type: 'quick-info'
      readonly source: string
      readonly language: SourceLanguage
      readonly position: number
    }
  | {
      readonly type: 'transpile'
      readonly source: string
    }
  | {
      readonly type: 'warm'
      readonly source: string
      readonly language: SourceLanguage
    }
