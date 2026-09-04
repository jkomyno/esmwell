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
 * - references to the `eval` identifier (property keys, member accesses like
 *   `obj.eval`, and export names like `export { foo as eval }` are fine)
 * - calls, constructions, and tagged-template invocations of the `Function`
 *   constructor, including via `Function.call`/`Function.apply`/`Function.bind`
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

    if (
      node.type === 'CallExpression' ||
      node.type === 'NewExpression' ||
      node.type === 'OptionalCallExpression' ||
      node.type === 'TaggedTemplateExpression'
    ) {
      const callee = readNodeChild(node, node.type === 'TaggedTemplateExpression' ? 'tag' : 'callee')
      if (callee !== null && isFunctionConstructorCallee(callee)) {
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

const FUNCTION_CONSTRUCTOR_METHODS: ReadonlySet<string> = new Set(['call', 'apply', 'bind'])

/**
 * Whether a call/construct/tag callee is a plain, unobfuscated reference to
 * the `Function` constructor: the bare identifier (`Function(...)`,
 * `new Function(...)`, `` Function`...` ``) or an invocation through
 * `Function.call`/`Function.apply`/`Function.bind`. Aliasing through a
 * variable or computed property access is out of scope.
 */
function isFunctionConstructorCallee(callee: Node): boolean {
  if (callee.type === 'Identifier') {
    return readNodeString(callee, 'name') === 'Function'
  }
  if (callee.type === 'MemberExpression' && !readNodeBoolean(callee, 'computed')) {
    const object = readNodeChild(callee, 'object')
    const property = readNodeChild(callee, 'property')
    return (
      object !== null &&
      object.type === 'Identifier' &&
      readNodeString(object, 'name') === 'Function' &&
      property !== null &&
      property.type === 'Identifier' &&
      FUNCTION_CONSTRUCTOR_METHODS.has(readNodeString(property, 'name') ?? '')
    )
  }
  return false
}

const MEMBER_PROPERTY_PARENTS: ReadonlySet<string> = new Set(['MemberExpression', 'OptionalMemberExpression'])
const KEY_PARENTS: ReadonlySet<string> = new Set(['Property', 'MethodDefinition', 'PropertyDefinition'])
const LABEL_PARENTS: ReadonlySet<string> = new Set(['LabeledStatement', 'BreakStatement', 'ContinueStatement'])
const EXPORTED_NAME_PARENTS: ReadonlySet<string> = new Set(['ExportSpecifier', 'ExportAllDeclaration'])

/**
 * Whether an `eval` identifier sits in a reference position, as opposed to a
 * non-reference position such as a property key (`{ eval: 1 }`), a member
 * access (`obj.eval`), a label, a foreign import name, or a published export
 * name (`export { foo as eval }` names the export string, it does not
 * reference the `eval` binding).
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
  if (key === 'exported' && EXPORTED_NAME_PARENTS.has(parent.type)) {
    // The `local` position of an ExportSpecifier stays a reference: it names
    // the binding being exported (`export { eval }` really does reference
    // it), while `exported` only names the string it is published under.
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
