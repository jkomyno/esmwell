import type { Node } from 'acorn'

/** Visitor for generic AST traversal; receives the parent node and the property name the node was found under. */
export type NodeVisitor = (node: Node, parent: Node | null, key: string) => void

/** Type guard for acorn AST nodes among arbitrary values. */
export const isAstNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'

/**
 * Depth-first traversal of every AST node. Shared nodes (shorthand object
 * properties use one node for key and value in some producers) are visited
 * once.
 */
export function walkNodes(root: Node, visitor: NodeVisitor): void {
  const visit = (node: Node, parent: Node | null, key: string): void => {
    visitor(node, parent, key)
    const visited = new Set<unknown>()
    for (const [childKey, value] of Object.entries(node)) {
      const children = Array.isArray(value) ? value : [value]
      for (const child of children) {
        if (isAstNode(child) && !visited.has(child)) {
          visited.add(child)
          visit(child, node, childKey)
        }
      }
    }
  }
  visit(root, null, '')
}

const readProperty = (node: Node, property: string): unknown => (node as unknown as Record<string, unknown>)[property]

/** Reads a string-valued node property, e.g. `kind` on a VariableDeclaration. */
export const readNodeString = (node: Node, property: string): string | undefined => {
  const value = readProperty(node, property)
  return typeof value === 'string' ? value : undefined
}

/** Reads a boolean-valued node property, e.g. `computed` on a Property. */
export const readNodeBoolean = (node: Node, property: string): boolean => readProperty(node, property) === true

/** Reads a node-valued property, e.g. `callee` on a CallExpression. */
export const readNodeChild = (node: Node, property: string): Node | null => {
  const value = readProperty(node, property)
  return isAstNode(value) ? value : null
}

/** Reads the node children of an array-valued property, e.g. `arguments` on a CallExpression. */
export const readNodeChildren = (node: Node, property: string): Node[] => {
  const value = readProperty(node, property)
  return Array.isArray(value) ? value.filter(isAstNode) : []
}

/** 1-based start line of a node parsed with locations. */
export const lineOfNode = (node: Node): number => node.loc?.start.line ?? 1
