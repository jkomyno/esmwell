import type { Node } from 'acorn'
import { lineOfNode, readNodeBoolean, readNodeChild, readNodeString, walkNodes } from './walk'

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

  walkNodes(ast, (node, parent, key) => {
    if (node.type === 'VariableDeclaration' && readNodeString(node, 'kind') === 'var') {
      violations.push(
        new PolicyViolation(
          'var',
          `var declarations are not allowed — use let or const instead (line ${lineOfNode(node)})`,
          lineOfNode(node),
        ),
      )
      return
    }

    if (node.type === 'Identifier' && readNodeString(node, 'name') === 'eval' && isEvalReference(parent, key)) {
      violations.push(
        new PolicyViolation(
          'eval',
          `eval is not allowed in submitted code (line ${lineOfNode(node)})`,
          lineOfNode(node),
        ),
      )
      return
    }

    if (node.type === 'CallExpression' || node.type === 'NewExpression' || node.type === 'OptionalCallExpression') {
      const callee = readNodeChild(node, 'callee')
      if (callee !== null && callee.type === 'Identifier' && readNodeString(callee, 'name') === 'Function') {
        violations.push(
          new PolicyViolation(
            'function-constructor',
            `Function constructor is not allowed in submitted code (line ${lineOfNode(callee)})`,
            lineOfNode(callee),
          ),
        )
      }
    }
  })

  return violations
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
    return readNodeBoolean(parent, 'computed')
  }
  return true
}
