import type { Node } from 'acorn'

/** Policy rules the gate enforces on user-submitted code. */
export type PolicyRule = 'var' | 'eval' | 'function-constructor'

/**
 * A user-code policy violation. The message is self-contained and actionable;
 * the line points at the offending declaration or reference.
 */
export class PolicyViolation extends Error {
  readonly rule: PolicyRule
  /** 1-based line of the violation. */
  readonly line: number

  constructor(rule: PolicyRule, message: string, line: number) {
    super(message)
    this.name = 'PolicyViolation'
    this.rule = rule
    this.line = line
  }
}

/**
 * Collects every policy violation in a parsed module:
 * - `var` declarations anywhere (including `for` heads) — use `let`/`const`
 * - references to the `eval` identifier (property keys and member accesses
 *   like `obj.eval` are fine)
 * - calls and constructions of the `Function` constructor
 *   (`a.Function()` is fine)
 *
 * Returns violations in source order; an empty array means the code passes.
 */
export function checkPolicy(ast: Node): PolicyViolation[] {
  const violations: PolicyViolation[] = []

  visitNode(ast, null, '', (node, parent, key) => {
    if (node.type === 'VariableDeclaration' && readString(node, 'kind') === 'var') {
      violations.push(
        new PolicyViolation(
          'var',
          `var declarations are not allowed — use let or const instead (line ${lineOf(node)})`,
          lineOf(node),
        ),
      )
      return
    }

    if (node.type === 'Identifier' && readString(node, 'name') === 'eval' && isEvalReference(parent, key)) {
      violations.push(
        new PolicyViolation('eval', `eval is not allowed in submitted code (line ${lineOf(node)})`, lineOf(node)),
      )
      return
    }

    if (node.type === 'CallExpression' || node.type === 'NewExpression' || node.type === 'OptionalCallExpression') {
      const callee = readNode(node, 'callee')
      if (callee !== null && callee.type === 'Identifier' && readString(callee, 'name') === 'Function') {
        violations.push(
          new PolicyViolation(
            'function-constructor',
            `Function constructor is not allowed in submitted code (line ${lineOf(callee)})`,
            lineOf(callee),
          ),
        )
      }
    }
  })

  return violations
}

type Visitor = (node: Node, parent: Node | null, key: string) => void

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'

/**
 * Depth-first traversal of every AST node, passing the parent node and the
 * property name the node was found under. Shared nodes (shorthand object
 * properties use the same node for key and value) are visited once.
 */
function visitNode(node: Node, parent: Node | null, key: string, visitor: Visitor): void {
  visitor(node, parent, key)
  const visited = new Set<unknown>()
  for (const [childKey, value] of Object.entries(node)) {
    const children = Array.isArray(value) ? value : [value]
    for (const child of children) {
      if (isNode(child) && !visited.has(child)) {
        visited.add(child)
        visitNode(child, node, childKey, visitor)
      }
    }
  }
}

const MEMBER_PROPERTY_PARENTS: ReadonlySet<string> = new Set(['MemberExpression', 'OptionalMemberExpression'])
const KEY_PARENTS: ReadonlySet<string> = new Set(['Property', 'MethodDefinition', 'PropertyDefinition'])
const LABEL_PARENTS: ReadonlySet<string> = new Set(['LabeledStatement', 'BreakStatement', 'ContinueStatement'])

/**
 * Whether an `eval` identifier sits in a reference position, as opposed to a
 * non-reference position such as a property key (`{ eval: 1 }`), a member
 * access (`obj.eval`), a label, or a foreign import name.
 */
function isEvalReference(parent: Node | null, key: string): boolean {
  if (parent === null) {
    return true
  }
  if (key === 'property' && MEMBER_PROPERTY_PARENTS.has(parent.type)) {
    return false
  }
  if (key === 'label' && LABEL_PARENTS.has(parent.type)) {
    return false
  }
  if (key === 'imported' && parent.type === 'ImportSpecifier') {
    return false
  }
  if (key === 'key' && KEY_PARENTS.has(parent.type)) {
    // Computed keys contain real expressions (`{ [eval]: 1 }` references
    // eval); plain keys are just names, and a shorthand `{ eval }` reports
    // its value node as the reference.
    return readBoolean(parent, 'computed')
  }
  return true
}

const lineOf = (node: Node): number => node.loc?.start.line ?? 1

const readString = (node: Node, property: string): string | undefined => {
  const value = (node as unknown as Record<string, unknown>)[property]
  return typeof value === 'string' ? value : undefined
}

const readBoolean = (node: Node, property: string): boolean => {
  const value = (node as unknown as Record<string, unknown>)[property]
  return value === true
}

const readNode = (node: Node, property: string): Node | null => {
  const value = (node as unknown as Record<string, unknown>)[property]
  return isNode(value) ? value : null
}
