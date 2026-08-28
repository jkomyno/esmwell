import type { Node, Program } from 'acorn'
import { isAstNode } from './walk'

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

  constructor(readonly parent: Scope | null) {}

  declares(name: string): void {
    this.names.add(name)
  }

  resolve(name: string): boolean {
    return this.names.has(name) || (this.parent?.resolve(name) ?? false)
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
  private readonly globalScope = new Scope(null)

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
    for (const specifier of this.children(node, 'specifiers')) {
      const local = this.child(specifier, 'local')
      const name = local !== null ? this.identifierName(local) : undefined
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
      for (const declarator of this.children(node, 'declarations')) {
        const id = this.child(declarator, 'id')
        if (id !== null) {
          this.collectPatternBindings(id, scope)
        }
      }
      return
    }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      const declaration = this.child(node, 'declaration')
      if (declaration !== null) {
        this.declareStatement(declaration, scope)
      }
      return
    }
    if (node.type === 'ClassDeclaration' || node.type === 'FunctionDeclaration') {
      const id = this.child(node, 'id')
      const name = id !== null ? this.identifierName(id) : undefined
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
        const name = this.identifierName(pattern)
        if (name !== undefined) {
          scope.declares(name)
          if (scope === this.globalScope) {
            this.topLevelDeclarations.push(name)
          }
        }
        return
      }
      case 'ObjectPattern':
        for (const property of this.children(pattern, 'properties')) {
          const value = this.child(property, 'value')
          if (value !== null) {
            this.collectPatternBindings(value, scope)
          }
        }
        return
      case 'ArrayPattern':
        for (const element of this.children(pattern, 'elements')) {
          if (element !== null) {
            this.collectPatternBindings(element, scope)
          }
        }
        return
      case 'RestElement': {
        const argument = this.child(pattern, 'argument')
        if (argument !== null) {
          this.collectPatternBindings(argument, scope)
        }
        return
      }
      case 'AssignmentPattern': {
        const left = this.child(pattern, 'left')
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

  private visit(node: Node, scope: Scope): void {
    switch (node.type) {
      case 'Identifier': {
        const name = this.identifierName(node)
        if (name !== undefined) {
          this.references.push({
            name,
            start: node.start,
            end: node.end,
            bound: scope.resolve(name),
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
        const blockScope = new Scope(scope)
        this.declareStatements(this.children(node, 'body'), blockScope)
        for (const statement of this.children(node, 'body')) {
          this.visit(statement, blockScope)
        }
        return
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const paramScope = new Scope(scope)
        const id = this.child(node, 'id')
        const name = id !== null ? this.identifierName(id) : undefined
        if (id !== null && name !== undefined) {
          // A named function expression binds its own name for its body.
          paramScope.declares(name)
        }
        for (const param of this.children(node, 'params')) {
          this.collectPatternBindings(param, paramScope)
          this.visitPatternDefaults(param, paramScope)
        }
        const body = this.child(node, 'body')
        if (body !== null) {
          this.visitFunctionBody(body, paramScope)
        }
        return
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const classScope = node.type === 'ClassExpression' ? new Scope(scope) : scope
        if (classScope !== scope) {
          const id = this.child(node, 'id')
          const className = id !== null ? this.identifierName(id) : undefined
          if (className !== undefined) {
            classScope.declares(className)
          }
        }
        // The extends clause evaluates outside the class-name binding.
        const superClass = this.child(node, 'superClass')
        if (superClass !== null) {
          this.visit(superClass, scope)
        }
        const body = this.child(node, 'body')
        if (body !== null) {
          this.visit(body, classScope)
        }
        return
      }
      case 'ForStatement': {
        const init = this.child(node, 'init')
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
        const left = this.child(node, 'left')
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
        const catchScope = new Scope(scope)
        const param = this.child(node, 'param')
        if (param !== null) {
          this.collectPatternBindings(param, catchScope)
          this.visitPatternDefaults(param, catchScope)
        }
        this.visitChild(node, catchScope, 'body')
        return
      }
      case 'SwitchStatement': {
        const caseScope = new Scope(scope)
        this.visitChild(node, scope, 'discriminant')
        for (const switchCase of this.children(node, 'cases')) {
          this.declareStatements(this.children(switchCase, 'consequent'), caseScope)
        }
        for (const switchCase of this.children(node, 'cases')) {
          this.visitChild(switchCase, scope, 'test')
          for (const consequent of this.children(switchCase, 'consequent')) {
            this.visit(consequent, caseScope)
          }
        }
        return
      }
      case 'Property':
      case 'PropertyDefinition': {
        // Plain keys are names; computed keys are real expressions. A
        // shorthand `{ x }` carries its reference in the value position.
        if (this.isComputed(node)) {
          this.visitChild(node, scope, 'key')
        }
        this.visitChild(node, scope, 'value')
        return
      }
      case 'MethodDefinition': {
        if (this.isComputed(node)) {
          this.visitChild(node, scope, 'key')
        }
        this.visitChild(node, scope, 'value')
        return
      }
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        this.visitChild(node, scope, 'object')
        if (this.isComputed(node)) {
          this.visitChild(node, scope, 'property')
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
        const right = this.child(pattern, 'right')
        if (right !== null) {
          this.deferredExpressions.push({ node: right, scope })
        }
        const left = this.child(pattern, 'left')
        if (left !== null) {
          this.visitPatternDefaults(left, scope)
        }
        return
      }
      case 'ObjectPattern':
        for (const property of this.children(pattern, 'properties')) {
          const value = this.child(property, 'value')
          if (value !== null) {
            this.visitPatternDefaults(value, scope)
          }
        }
        return
      case 'ArrayPattern':
        for (const element of this.children(pattern, 'elements')) {
          if (element !== null) {
            this.visitPatternDefaults(element, scope)
          }
        }
        return
      case 'RestElement': {
        const argument = this.child(pattern, 'argument')
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
      const blockScope = new Scope(paramScope)
      this.declareStatements(this.children(body, 'body'), blockScope)
      for (const statement of this.children(body, 'body')) {
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
    const headScope = new Scope(outer)
    for (const declarator of this.children(head, 'declarations')) {
      const id = this.child(declarator, 'id')
      if (id !== null) {
        this.collectPatternBindings(id, headScope)
        this.visitPatternDefaults(id, headScope)
      }
    }
    return headScope
  }

  /** Visits the initializer expressions of a variable declaration's declarators. */
  private visitVariableDeclaration(node: Node, scope: Scope): void {
    for (const declarator of this.children(node, 'declarations')) {
      const id = this.child(declarator, 'id')
      const init = this.child(declarator, 'init')
      if (id !== null) {
        this.visitPatternDefaults(id, scope)
      }
      if (init !== null) {
        this.visit(init, scope)
      }
    }
  }

  private visitChild(node: Node, fallbackScope: Scope, property: string): void {
    const child = this.child(node, property)
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

  private readonly children = (node: Node, property: string): Node[] => {
    const value = (node as unknown as Record<string, unknown>)[property]
    return Array.isArray(value) ? value.filter(isAstNode) : []
  }

  private readonly child = (node: Node, property: string): Node | null => {
    const value = (node as unknown as Record<string, unknown>)[property]
    return isAstNode(value) ? value : null
  }

  private readonly isComputed = (node: Node): boolean => (node as unknown as Record<string, unknown>).computed === true

  private readonly identifierName = (node: Node): string | undefined => {
    const name = (node as unknown as Record<string, unknown>).name
    return typeof name === 'string' ? name : undefined
  }
}
