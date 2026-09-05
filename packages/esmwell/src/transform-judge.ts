import type { Node, Program } from 'acorn'
import { applyEdits, quoteString } from './edits'
import type { SourceEdit } from './edits'
import { importMetaMainEdits } from './import-meta'
import { resolveImportSpecifier } from './resolve'
import type { ResolvedDependency, ResolveOptions } from './resolve'
import { readNodeChild, readNodeString, walkNodes } from './walk'

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
 * cannot be resolved. The submitted module is the program a judge run
 * starts from, so its `import.meta.main` is `true`.
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
  edits.push(...importMetaMainEdits(code, ast, true))

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
