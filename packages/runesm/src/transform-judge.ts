import type { Node, Program } from 'acorn'
import { resolveImportSpecifier } from './resolve'
import type { ResolvedDependency, ResolveOptions } from './resolve'
import { readNodeChild, readNodeString, walkNodes } from './walk'

/** A source-range replacement computed from the AST. */
interface SourceEdit {
  start: number
  end: number
  replacement: string
}

/** The rewritten module source plus the dependencies it resolved to. */
export interface JudgeTransform {
  code: string
  dependencies: ResolvedDependency[]
}

/**
 * Rewrites every module specifier in user code to its resolved URL: static
 * `import … from`, `export … from`, `export * from`, and literal dynamic
 * `import('…')` specifiers. Non-literal dynamic imports pass through
 * untouched. Throws {@link SpecifierResolutionError} when any specifier
 * cannot be resolved.
 */
export function transformJudgeModule(code: string, ast: Program, options: ResolveOptions): JudgeTransform {
  const edits: SourceEdit[] = []
  const dependencies: ResolvedDependency[] = []
  const seen = new Set<string>()

  walkNodes(ast, (node) => {
    const source = moduleSourceNode(node)
    if (source === null || source.type !== 'Literal') {
      return
    }
    const specifier = readNodeString(source, 'value')
    if (specifier === undefined) {
      return
    }

    const resolved = resolveImportSpecifier(specifier, options)
    edits.push({
      start: source.start,
      end: source.end,
      replacement: quoteString(resolved.url),
    })
    if (resolved.dependency !== undefined && !seen.has(resolved.dependency.specifier)) {
      seen.add(resolved.dependency.specifier)
      dependencies.push(resolved.dependency)
    }
  })

  return { code: applyEdits(code, edits), dependencies }
}

/** The `source` node of import/export declarations and literal dynamic imports, if present. */
const moduleSourceNode = (node: Node): Node | null => {
  switch (node.type) {
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration':
    case 'ImportExpression':
      return readNodeChild(node, 'source')
    default:
      return null
  }
}

/** Applies non-overlapping edits back-to-front so earlier offsets stay valid. */
const applyEdits = (code: string, edits: SourceEdit[]): string => {
  let result = code
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

/** Serializes a URL as a single-quoted JavaScript string literal. */
const quoteString = (value: string): string => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
