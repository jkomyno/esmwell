import type { Node, Program } from 'acorn'
import { isAstNode, readNodeBoolean, readNodeChild, readNodeChildren, readNodeString } from './walk'

/**
 * A resolved identifier reference in reference position: property keys,
 * member accesses, labels, and foreign import names are not references.
 */
export interface IdentifierRef {
  readonly name: string
  readonly start: number
  readonly end: number
  /** True when a binding somewhere in the input covers the reference. */
  readonly bound: boolean
  /**
   * True when the reference resolves to the input's top-level scope — the
   * binding itself (declaration or import) or nothing at all (a global).
   * REPL rewriting turns exactly these into scope-object reads and writes.
   */
  readonly programLevel: boolean
  /** True inside a shorthand property value: rewriting must emit `name: <ref>`. */
  readonly inShorthandProperty: boolean
}

/** The result of analyzing one user input. */
export interface ScopeAnalysis {
  /** Names declared at the top level of the input (excluding imports). */
  readonly topLevelDeclarations: readonly string[]
  /** Names the input's import statements bind (they become scope assignments). */
  readonly importedNames: readonly string[]
  /** Every identifier reference in the input, in encounter order (pattern
   * default values surface at their statement's boundary). */
  readonly references: readonly IdentifierRef[]
}

class Scope {
  readonly names = new Set<string>()

  constructor(
    readonly parent: Scope | null,
    readonly isProgram: boolean,
  ) {}

  declares(name: string): void {
    this.names.add(name)
  }

  resolve(name: string): boolean {
    return this.names.has(name) || (this.parent?.resolve(name) ?? false)
  }

  /** The nearest scope declaring `name`, or null when the reference is unbound. */
  bindingScope(name: string): Scope | null {
    if (this.names.has(name)) {
      return this
    }
    return this.parent?.bindingScope(name) ?? null
  }
}

/**
 * Analyzes the lexical scope structure of one input: which top-level names
 * it declares, which names its imports bind, and for every identifier
 * reference whether a binding within the input covers it. References in
 * non-reference positions (property keys, member accesses, labels, computed
 * keys' key positions, meta properties) are not reported at all.
 *
 * The restricted question — "bound in this input?" — keeps this small:
 * there is no cross-input state, and `var` never reaches the analyzer
 * because the policy gate rejects it first.
 */
export function analyzeScope(program: Program): ScopeAnalysis {
  const analyzer = new Analyzer()
  return analyzer.analyze(program)
}

class Analyzer {
  private readonly references: IdentifierRef[] = []
  private readonly topLevelDeclarations: string[] = []
  private readonly importedNames: string[] = []
  private readonly globalScope = new Scope(null, true)

  analyze(program: Program): ScopeAnalysis {
    // Imports bind first: module-level declarations are visible before
    // evaluation order matters for this analysis.
    for (const statement of program.body) {
      this.collectImports(statement, this.globalScope)
    }
    this.declareStatements(program.body, this.globalScope)

    for (const statement of program.body) {
      this.visitStatement(statement, this.globalScope)
    }

    return {
      topLevelDeclarations: [...this.topLevelDeclarations],
      importedNames: [...this.importedNames],
      references: this.references,
    }
  }

  private collectImports(node: Node, scope: Scope): void {
    if (node.type !== 'ImportDeclaration') {
      return
    }
    for (const specifier of readNodeChildren(node, 'specifiers')) {
      const local = readNodeChild(specifier, 'local')
      const name = local !== null ? readNodeString(local, 'name') : undefined
      if (local !== null && name !== undefined) {
        scope.declares(name)
        this.importedNames.push(name)
      }
    }
  }

  /** Declares the bindings a list of statements introduces into `scope` (hoisting). */
  private declareStatements(statements: readonly Node[], scope: Scope): void {
    for (const statement of statements) {
      this.declareStatement(statement, scope)
    }
  }

  private declareStatement(node: Node, scope: Scope): void {
    if (node.type === 'VariableDeclaration') {
      for (const declarator of readNodeChildren(node, 'declarations')) {
        const id = readNodeChild(declarator, 'id')
        if (id !== null) {
          this.collectPatternBindings(id, scope)
        }
      }
      return
    }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      const declaration = readNodeChild(node, 'declaration')
      if (declaration !== null) {
        this.declareStatement(declaration, scope)
      }
      return
    }
    if (node.type === 'ClassDeclaration' || node.type === 'FunctionDeclaration') {
      const id = readNodeChild(node, 'id')
      const name = id !== null ? readNodeString(id, 'name') : undefined
      if (id !== null && name !== undefined && !scope.names.has(name)) {
        scope.declares(name)
        if (scope === this.globalScope) {
          this.topLevelDeclarations.push(name)
        }
      }
    }
  }

  /** Collects the binding names inside a declaration pattern, deferring default-value expressions. */
  private collectPatternBindings(pattern: Node, scope: Scope): void {
    switch (pattern.type) {
      case 'Identifier': {
        const name = readNodeString(pattern, 'name')
        if (name !== undefined) {
          scope.declares(name)
          if (scope === this.globalScope) {
            this.topLevelDeclarations.push(name)
          }
        }
        return
      }
      case 'ObjectPattern':
        for (const property of readNodeChildren(pattern, 'properties')) {
          // A rest property carries its binding on `argument`, not `value`.
          if (property.type === 'RestElement') {
            this.collectPatternBindings(property, scope)
            continue
          }
          const value = readNodeChild(property, 'value')
          if (value !== null) {
            this.collectPatternBindings(value, scope)
          }
        }
        return
      case 'ArrayPattern':
        for (const element of readNodeChildren(pattern, 'elements')) {
          if (element !== null) {
            this.collectPatternBindings(element, scope)
          }
        }
        return
      case 'RestElement': {
        const argument = readNodeChild(pattern, 'argument')
        if (argument !== null) {
          this.collectPatternBindings(argument, scope)
        }
        return
      }
      case 'AssignmentPattern': {
        const left = readNodeChild(pattern, 'left')
        if (left !== null) {
          this.collectPatternBindings(left, scope)
        }
        return
      }
      default:
        return
    }
  }

  /** Expressions that only become reachable after their scope's bindings exist. */
  private readonly deferredExpressions: Array<{ node: Node; scope: Scope }> = []

  private visitStatement(node: Node, scope: Scope): void {
    this.visit(node, scope)
    this.flushDeferred()
  }

  private flushDeferred(): void {
    while (this.deferredExpressions.length > 0) {
      const deferred = this.deferredExpressions.pop()
      if (deferred !== undefined) {
        this.visit(deferred.node, deferred.scope)
      }
    }
  }

  private visit(node: Node, scope: Scope, inShorthandProperty = false): void {
    switch (node.type) {
      case 'Identifier': {
        const name = readNodeString(node, 'name')
        if (name !== undefined) {
          const bindingScope = scope.bindingScope(name)
          this.references.push({
            name,
            start: node.start,
            end: node.end,
            bound: bindingScope !== null,
            programLevel: bindingScope === null || bindingScope.isProgram,
            inShorthandProperty,
          })
        }
        return
      }
      case 'VariableDeclaration': {
        this.visitVariableDeclaration(node, scope)
        return
      }
      case 'BlockStatement':
      case 'StaticBlock': {
        const blockScope = new Scope(scope, false)
        this.declareStatements(readNodeChildren(node, 'body'), blockScope)
        for (const statement of readNodeChildren(node, 'body')) {
          this.visit(statement, blockScope)
        }
        return
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const paramScope = new Scope(scope, false)
        const id = readNodeChild(node, 'id')
        const name = id !== null ? readNodeString(id, 'name') : undefined
        if (id !== null && name !== undefined) {
          // A named function expression binds its own name for its body.
          paramScope.declares(name)
        }
        for (const param of readNodeChildren(node, 'params')) {
          this.collectPatternBindings(param, paramScope)
          this.visitPatternDefaults(param, paramScope)
        }
        const body = readNodeChild(node, 'body')
        if (body !== null) {
          this.visitFunctionBody(body, paramScope)
        }
        return
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        // A class body sees its own name through an inner, immutable binding
        // (like a named function expression), so self-references — including
        // static initializers, which run before any outer assignment lands —
        // must stay lexical rather than become scope-object reads.
        const classScope = new Scope(scope, false)
        const id = readNodeChild(node, 'id')
        const className = id !== null ? readNodeString(id, 'name') : undefined
        if (className !== undefined) {
          classScope.declares(className)
        }
        // The extends clause evaluates outside the class-name binding.
        const superClass = readNodeChild(node, 'superClass')
        if (superClass !== null) {
          this.visit(superClass, scope)
        }
        const body = readNodeChild(node, 'body')
        if (body !== null) {
          this.visit(body, classScope)
        }
        return
      }
      case 'ForStatement': {
        const init = readNodeChild(node, 'init')
        const headScope = this.forHeadScope(init, scope)
        if (init !== null) {
          if (init.type === 'VariableDeclaration') {
            this.visitVariableDeclaration(init, headScope)
          } else {
            this.visit(init, headScope)
          }
        }
        this.visitChild(node, headScope, 'test')
        this.visitChild(node, headScope, 'update')
        this.visitChild(node, headScope, 'body')
        return
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const left = readNodeChild(node, 'left')
        const headScope = this.forHeadScope(left, scope)
        // The iterable evaluates before the binding exists.
        this.visitChild(node, scope, 'right')
        if (left !== null && left.type === 'VariableDeclaration') {
          this.visitVariableDeclaration(left, headScope)
        } else if (left !== null) {
          this.visit(left, headScope)
        }
        this.visitChild(node, headScope, 'body')
        return
      }
      case 'CatchClause': {
        const catchScope = new Scope(scope, false)
        const param = readNodeChild(node, 'param')
        if (param !== null) {
          this.collectPatternBindings(param, catchScope)
          this.visitPatternDefaults(param, catchScope)
        }
        this.visitChild(node, catchScope, 'body')
        return
      }
      case 'SwitchStatement': {
        const caseScope = new Scope(scope, false)
        this.visitChild(node, scope, 'discriminant')
        for (const switchCase of readNodeChildren(node, 'cases')) {
          this.declareStatements(readNodeChildren(switchCase, 'consequent'), caseScope)
        }
        for (const switchCase of readNodeChildren(node, 'cases')) {
          this.visitChild(switchCase, scope, 'test')
          for (const consequent of readNodeChildren(switchCase, 'consequent')) {
            this.visit(consequent, caseScope)
          }
        }
        return
      }
      case 'Property':
      case 'PropertyDefinition': {
        // Plain keys are names; computed keys are real expressions. A
        // shorthand `{ x }` carries its reference in the value position.
        if (readNodeBoolean(node, 'computed')) {
          this.visitChild(node, scope, 'key')
        }
        const value = readNodeChild(node, 'value')
        if (value !== null) {
          const shorthand = readNodeBoolean(node, 'shorthand')
          this.visit(value, scope, shorthand)
        }
        return
      }
      case 'MethodDefinition': {
        if (readNodeBoolean(node, 'computed')) {
          this.visitChild(node, scope, 'key')
        }
        this.visitChild(node, scope, 'value')
        return
      }
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        this.visitChild(node, scope, 'object')
        if (readNodeBoolean(node, 'computed')) {
          this.visitChild(node, scope, 'property')
        }
        return
      }
      case 'AssignmentPattern': {
        // Forwards `inShorthandProperty` to the target so cover-initialized
        // shorthand properties in assignment destructuring (`({ a = 1 } =
        // obj)`, as opposed to a declaration) rewrite the same way the
        // declaration path does.
        const left = readNodeChild(node, 'left')
        if (left !== null) {
          this.visit(left, scope, inShorthandProperty)
        }
        const right = readNodeChild(node, 'right')
        if (right !== null) {
          this.visit(right, scope)
        }
        return
      }
      case 'LabeledStatement': {
        this.visitChild(node, scope, 'body')
        return
      }
      case 'BreakStatement':
      case 'ContinueStatement': {
        return
      }
      case 'MetaProperty': {
        return
      }
      case 'ImportDeclaration':
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier': {
        return
      }
      case 'ExportSpecifier': {
        // `export { local as exported }`: local is a reference, exported is a foreign name.
        this.visitChild(node, scope, 'local')
        return
      }
      default: {
        this.visitChildren(node, scope)
        return
      }
    }
  }

  /** Visits the initializer expressions inside a binding pattern's defaults. */
  private visitPatternDefaults(pattern: Node, scope: Scope): void {
    switch (pattern.type) {
      case 'AssignmentPattern': {
        const right = readNodeChild(pattern, 'right')
        if (right !== null) {
          this.deferredExpressions.push({ node: right, scope })
        }
        const left = readNodeChild(pattern, 'left')
        if (left !== null) {
          this.visitPatternDefaults(left, scope)
        }
        return
      }
      case 'ObjectPattern':
        for (const property of readNodeChildren(pattern, 'properties')) {
          // A computed key (`{ [k]: v }`) is a real expression, not a
          // binding name; defer it so `k` is reported as a free reference
          // and gets rewritten like any other program-level read.
          if (readNodeBoolean(property, 'computed')) {
            const key = readNodeChild(property, 'key')
            if (key !== null) {
              this.deferredExpressions.push({ node: key, scope })
            }
          }
          const value = readNodeChild(property, 'value')
          if (value !== null) {
            this.visitPatternDefaults(value, scope)
          }
        }
        return
      case 'ArrayPattern':
        for (const element of readNodeChildren(pattern, 'elements')) {
          if (element !== null) {
            this.visitPatternDefaults(element, scope)
          }
        }
        return
      case 'RestElement': {
        const argument = readNodeChild(pattern, 'argument')
        if (argument !== null) {
          this.visitPatternDefaults(argument, scope)
        }
        return
      }
      default:
        return
    }
  }

  private visitFunctionBody(body: Node, paramScope: Scope): void {
    if (body.type === 'BlockStatement' || body.type === 'StaticBlock') {
      const blockScope = new Scope(paramScope, false)
      this.declareStatements(readNodeChildren(body, 'body'), blockScope)
      for (const statement of readNodeChildren(body, 'body')) {
        this.visit(statement, blockScope)
      }
      return
    }
    this.visit(body, paramScope)
  }

  private forHeadScope(head: Node | null, outer: Scope): Scope {
    if (head === null || head.type !== 'VariableDeclaration') {
      return outer
    }
    const headScope = new Scope(outer, false)
    for (const declarator of readNodeChildren(head, 'declarations')) {
      const id = readNodeChild(declarator, 'id')
      if (id !== null) {
        this.collectPatternBindings(id, headScope)
        this.visitPatternDefaults(id, headScope)
      }
    }
    return headScope
  }

  /** Visits the initializer expressions of a variable declaration's declarators. */
  private visitVariableDeclaration(node: Node, scope: Scope): void {
    for (const declarator of readNodeChildren(node, 'declarations')) {
      const id = readNodeChild(declarator, 'id')
      const init = readNodeChild(declarator, 'init')
      if (id !== null) {
        this.visitPatternDefaults(id, scope)
      }
      if (init !== null) {
        this.visit(init, scope)
      }
    }
  }

  private visitChild(node: Node, fallbackScope: Scope, property: string): void {
    const child = readNodeChild(node, property)
    if (child !== null) {
      this.visit(child, fallbackScope)
    }
  }

  private visitChildren(node: Node, scope: Scope): void {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range' || key === 'type' || key === 'start' || key === 'end') {
        continue
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) {
            this.visit(item, scope)
          }
        }
      } else if (isAstNode(value)) {
        this.visit(value, scope)
      }
    }
  }
}
