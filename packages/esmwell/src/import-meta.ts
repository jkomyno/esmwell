import type { Node, Program } from 'acorn'
import type { SourceEdit } from './edits'
import { readNodeChild, readNodeString, walkNodes } from './walk'

/**
 * Edits that give every `import.meta` in `code` a `main` property.
 *
 * The browser exposes no hook for adding properties to a module's
 * `import.meta`, and the object is reachable only through that syntax, so
 * each occurrence is rewritten in place to
 * `(import.meta.main = <main>, import.meta)`. The property therefore exists
 * before any read, destructuring, `in` check, or key enumeration can observe
 * it, while `url` and `resolve` keep their native values.
 *
 * The original text of the meta property is kept inside the replacement, so
 * no line is added or removed: line numbers in stack traces and error
 * reports stay the author's. Only columns to the right of an `import.meta`
 * on the same line move.
 *
 * Assigning on every read keeps the flag runtime-owned: submitted code can
 * write `import.meta.main`, but the next `import.meta` read restores it.
 */
export const importMetaMainEdits = (code: string, ast: Program, main: boolean): SourceEdit[] => {
  const edits: SourceEdit[] = []
  walkNodes(ast, (node) => {
    if (isImportMeta(node)) {
      const original = code.slice(node.start, node.end)
      edits.push({ start: node.start, end: node.end, replacement: `(${original}.main = ${main}, import.meta)` })
    }
  })
  return edits
}

/** `import.meta`, as opposed to the other meta property, `new.target`. */
const isImportMeta = (node: Node): boolean => {
  if (node.type !== 'MetaProperty') {
    return false
  }
  const meta = readNodeChild(node, 'meta')
  return meta !== null && readNodeString(meta, 'name') === 'import'
}
