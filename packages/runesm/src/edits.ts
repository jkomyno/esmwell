/** A source-range replacement computed from the AST. */
export interface SourceEdit {
  start: number
  end: number
  replacement: string
}

/**
 * Applies non-overlapping edits back-to-front so earlier offsets stay valid.
 *
 * Edits are processed in descending `start` order via {@link Array.prototype.toSorted},
 * which is spec-guaranteed stable: edits that share a `start` (zero-width
 * insertions at the same offset) keep their relative order from `edits`.
 * Because each such edit is spliced into the exact offset left behind by the
 * one processed just before it, that ordering renders in reverse — the edit
 * pushed *later* into `edits` ends up appearing *before* the one pushed
 * earlier at the same offset in the final string. Callers stacking multiple
 * zero-width edits at one offset must push them in the reverse of their
 * intended left-to-right rendering order.
 */
export function applyEdits(code: string, edits: readonly SourceEdit[]): string {
  let result = code
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

/**
 * Serializes a value as a single-quoted JavaScript string literal, for
 * embedding into generated module source (for example a resolved import
 * URL rewritten into an `import`/`export` specifier or a dynamic `import(…)`
 * call). This is a source-code quoter, not a display quoter: it must stay
 * a faithful, escaping-only round trip of `value` as valid JS syntax. A
 * human-facing preview (see `console.ts`'s own `quoteString`) may truncate,
 * so the two contracts stay separate.
 */
export function quoteString(value: string): string {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}'`
}
