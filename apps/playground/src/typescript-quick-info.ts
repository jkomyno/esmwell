import * as ts from 'typescript-legacy'
import type { TypeScriptQuickInfo } from './typescript-protocol'

export const serializeQuickInfo = (info: ts.QuickInfo | undefined): TypeScriptQuickInfo | null => {
  if (info === undefined) {
    return null
  }
  return {
    from: info.textSpan.start,
    to: info.textSpan.start + info.textSpan.length,
    displayParts: info.displayParts?.map(({ kind, text }) => ({ kind, text })) ?? [],
    documentation: ts.displayPartsToString(info.documentation),
  }
}
