import type { Node } from 'acorn'
import { isBareSpecifier } from './resolve'
import { readNodeChild, readNodeString, walkNodes } from './walk'

/**
 * Collects the unique bare package specifiers a module imports, in source
 * order: static `import … from`, `export … from`, `export * from`, and
 * dynamic `import('…')` calls with a literal argument. Relative, URL, and
 * computed specifiers are not collected.
 */
export function collectBareSpecifiers(ast: Node): string[] {
  const seen = new Set<string>()
  const specifiers: string[] = []
  const add = (source: string | undefined): void => {
    if (source !== undefined && isBareSpecifier(source) && !seen.has(source)) {
      seen.add(source)
      specifiers.push(source)
    }
  }

  walkNodes(ast, (node) => {
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      add(literalValue(readNodeChild(node, 'source')))
      return
    }
    // Dynamic `import('…')`: acorn represents it as an ImportExpression.
    if (node.type === 'ImportExpression') {
      add(literalValue(readNodeChild(node, 'source')))
    }
  })

  return specifiers
}

const literalValue = (node: Node | null): string | undefined => {
  if (node !== null && node.type === 'Literal') {
    const value = readNodeString(node, 'value')
    return value
  }
  return undefined
}
