import type { Node, Program } from 'acorn'
import { applyEdits, quoteString } from './edits'
import type { SourceEdit } from './edits'
import { analyzeScope } from './scope-analysis'
import { resolveImportSpecifier } from './resolve'
import type { ResolvedDependency, ResolveOptions } from './resolve'
import { isAstNode, readNodeBoolean, readNodeChild, readNodeChildren, readNodeString } from './walk'

/** The persistent scope object every REPL module shares. */
export const SCOPE_BINDING = '__runesm'

/** A non-throwing view used only for direct `typeof identifier` reads. */
const TYPEOF_SCOPE_BINDING = '__runesmTypeof'

/** The export the generated module exposes the completion value through. */
export const RESULT_EXPORT = '__runesmResult'

/** Error thrown for constructs the REPL cannot rewrite. */
export class ReplTransformError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplTransformError'
  }
}

/** One rewritten input plus the dependencies its imports resolved to. */
export interface ReplTransform {
  /** A complete module: it imports the scope object and exports the completion value. */
  readonly code: string
  readonly dependencies: ResolvedDependency[]
}

/** A top-level function declaration pulled out of the body and re-emitted ahead of it. */
interface HoistedFunction {
  readonly start: number
  readonly end: number
  readonly name: string
}

/**
 * Rewrites one REPL input into a module of the shape
 *
 * ```js
 * import { __runesm, __runesmTypeof } from '<scopeModuleUrl>'
 * export const __runesmResult = await (async () => {
 *   …rewritten statements…
 *   return <final expression>   // present when the input ends in an expression
 * })()
 * ```
 *
 * Top-level declarations become scope assignments (so later inputs see
 * them), references that resolve to the input's top level — including
 * globals — become live scope reads, imports become dynamic-import
 * assignments resolved through the CDN policy, and top-level await works
 * inside the async wrapper. Top-level function declarations are hoisted
 * ahead of the rest of the body so they stay callable before their textual
 * position, matching normal function-declaration hoisting; class
 * declarations are intentionally left in place since class bindings are in
 * the temporal dead zone until evaluated. Named ESM declarations are treated
 * like ordinary REPL declarations, so a module can seed the persistent scope.
 */
export function transformReplInput(
  input: string,
  ast: Program,
  options: ResolveOptions & { scopeModuleUrl: string },
): ReplTransform {
  const analysis = analyzeScope(ast)
  const edits: SourceEdit[] = []
  const dependencies: ResolvedDependency[] = []
  const seenDependencies = new Set<string>()
  const hoistedFunctions: HoistedFunction[] = []
  const erasedExportRanges: Array<{ start: number; end: number }> = []

  ast.body.forEach((statement, index) => {
    const replStatement = unwrapExportStatement(statement, edits, erasedExportRanges)
    if (replStatement === null) {
      return
    }
    if (replStatement.type === 'ImportDeclaration') {
      const replacement = rewriteImportStatement(replStatement, index, options, dependencies, seenDependencies)
      edits.push({ start: replStatement.start, end: replStatement.end, replacement })
      return
    }
    if (replStatement.type === 'FunctionDeclaration') {
      const id = readNodeChild(replStatement, 'id')
      const name = id !== null ? readNodeString(id, 'name') : undefined
      if (id !== null && name !== undefined) {
        // The declaration is removed from its textual position and
        // re-emitted as a prologue assignment (see `splitHoistedPrologue`),
        // so calling it before its textual position works.
        hoistedFunctions.push({ start: replStatement.start, end: replStatement.end, name })
        // A bare `;` keeps the neighbours separated: without it,
        // semicolon-free input fuses `foo()\n\n[1]` into `foo()[1]`.
        edits.push({ start: replStatement.start, end: replStatement.end, replacement: ';' })
        return
      }
    }
    rewriteTopLevelDeclaration(replStatement, edits)
  })

  for (const reference of analysis.references) {
    if (
      !reference.programLevel ||
      reference.name === SCOPE_BINDING ||
      reference.name === TYPEOF_SCOPE_BINDING ||
      erasedExportRanges.some((range) => reference.start >= range.start && reference.end <= range.end)
    ) {
      continue
    }
    const scopeBinding = reference.directTypeof && !reference.bound ? TYPEOF_SCOPE_BINDING : SCOPE_BINDING
    if (reference.inShorthandProperty) {
      edits.push({
        start: reference.start,
        end: reference.end,
        replacement: `${reference.name}: ${scopeBinding}.${reference.name}`,
      })
    } else {
      edits.push({
        start: reference.start,
        end: reference.start,
        replacement: `${scopeBinding}.`,
      })
    }
  }

  const completion = lastExpressionStatement(ast)
  if (completion !== null) {
    edits.push({ start: completion.start, end: completion.start, replacement: 'return ' })
  }

  const { prologue, body } = splitHoistedPrologue(input, edits, hoistedFunctions)

  return {
    code: [
      `import { ${SCOPE_BINDING}, ${TYPEOF_SCOPE_BINDING} } from ${quoteString(options.scopeModuleUrl)}`,
      `export const ${RESULT_EXPORT} = await (async () => {`,
      ...(prologue.length > 0 ? [prologue] : []),
      ...(body.length > 0 ? [body] : []),
      `})()`,
    ].join('\n'),
    dependencies,
  }
}

/** Removes ESM export syntax while preserving declarations as REPL bindings. */
function unwrapExportStatement(
  statement: Node,
  edits: SourceEdit[],
  erasedRanges: Array<{ start: number; end: number }>,
): Node | null {
  if (statement.type === 'ExportAllDeclaration') {
    throw new ReplTransformError('REPL input cannot use export * — import the bindings that should enter the scope')
  }
  if (statement.type === 'ExportNamedDeclaration') {
    if (readNodeChild(statement, 'source') !== null) {
      throw new ReplTransformError(
        'REPL input cannot re-export from another module — import the bindings that should enter the scope',
      )
    }
    const declaration = readNodeChild(statement, 'declaration')
    if (declaration === null) {
      erasedRanges.push({ start: statement.start, end: statement.end })
      edits.push({ start: statement.start, end: statement.end, replacement: ';' })
      return null
    }
    edits.push({ start: statement.start, end: declaration.start, replacement: '' })
    return declaration
  }
  if (statement.type === 'ExportDefaultDeclaration') {
    const declaration = readNodeChild(statement, 'declaration')
    const id = declaration === null ? null : readNodeChild(declaration, 'id')
    if (
      declaration === null ||
      (declaration.type !== 'FunctionDeclaration' && declaration.type !== 'ClassDeclaration') ||
      id === null
    ) {
      throw new ReplTransformError(
        'a default export needs a named function or class to become a persistent REPL binding',
      )
    }
    edits.push({ start: statement.start, end: declaration.start, replacement: '' })
    return declaration
  }
  return statement
}

const lastExpressionStatement = (ast: Program): Node | null => {
  const last = ast.body[ast.body.length - 1]
  return last !== undefined && last.type === 'ExpressionStatement' ? last : null
}

/**
 * Separates the edits that fall inside a hoisted function's own source range
 * from the rest. Each hoisted function is rendered on its own, with only the
 * edits enclosed by its range applied (offset to that range), and prepended
 * as a `<scope>.<name> = <function>` assignment; everything else — including
 * the edit that blanks out the function's original position — renders as
 * the ordinary body.
 */
const splitHoistedPrologue = (
  input: string,
  edits: readonly SourceEdit[],
  hoistedFunctions: readonly HoistedFunction[],
): { prologue: string; body: string } => {
  if (hoistedFunctions.length === 0) {
    return { prologue: '', body: applyEdits(input, edits) }
  }

  // The edit that deletes a hoisted function's own statement spans its exact
  // range; that one belongs to the body (it is what removes the function
  // from its original position), not to the function's own rendering.
  const enclosingFunction = (edit: SourceEdit): HoistedFunction | undefined =>
    hoistedFunctions.find(
      (fn) => edit.start >= fn.start && edit.end <= fn.end && !(edit.start === fn.start && edit.end === fn.end),
    )

  const bodyEdits: SourceEdit[] = []
  const perFunctionEdits = new Map<HoistedFunction, SourceEdit[]>(hoistedFunctions.map((fn) => [fn, []]))

  for (const edit of edits) {
    const fn = enclosingFunction(edit)
    if (fn === undefined) {
      bodyEdits.push(edit)
    } else {
      perFunctionEdits.get(fn)?.push(edit)
    }
  }

  const prologue = hoistedFunctions
    .map((fn) => {
      const relativeEdits = (perFunctionEdits.get(fn) ?? []).map((edit) => ({
        start: edit.start - fn.start,
        end: edit.end - fn.start,
        replacement: edit.replacement,
      }))
      return `${SCOPE_BINDING}.${fn.name} = ${applyEdits(input.slice(fn.start, fn.end), relativeEdits)}`
    })
    .join('\n')

  return { prologue, body: applyEdits(input, bodyEdits).trim() }
}

/** Rewrites one top-level import statement into dynamic-import scope assignments. */
function rewriteImportStatement(
  statement: Node,
  index: number,
  options: ResolveOptions,
  dependencies: ResolvedDependency[],
  seen: Set<string>,
): string {
  const source = readNodeChild(statement, 'source')
  const specifierValue = source !== null && source.type === 'Literal' ? readNodeString(source, 'value') : undefined
  if (specifierValue === undefined) {
    throw new ReplTransformError('import statements need a literal module specifier')
  }
  const resolved = resolveImportSpecifier(specifierValue, options)
  if (resolved.dependency !== undefined && !seen.has(resolved.dependency.specifier)) {
    seen.add(resolved.dependency.specifier)
    dependencies.push(resolved.dependency)
  }
  const url = quoteString(resolved.url)
  const moduleVar = `__runesm_mod_${index}`

  const specifiers = readNodeChildren(statement, 'specifiers')
  if (specifiers.length === 0) {
    // The trailing `;` keeps the following semicolon-free line from being
    // parsed as part of the import expression.
    return `await import(${url});`
  }

  const lines: string[] = [`const ${moduleVar} = await import(${url})`]
  for (const specifier of specifiers) {
    const local = readNodeChild(specifier, 'local')
    const localName = local !== null ? readNodeString(local, 'name') : undefined
    if (localName === undefined) {
      continue
    }
    if (specifier.type === 'ImportNamespaceSpecifier') {
      lines.push(`${SCOPE_BINDING}.${localName} = ${moduleVar}`)
    } else if (specifier.type === 'ImportDefaultSpecifier') {
      lines.push(`${SCOPE_BINDING}.${localName} = ${moduleVar}.default`)
    } else {
      const imported = readNodeChild(specifier, 'imported')
      const importedName =
        imported === null
          ? undefined
          : imported.type === 'Literal'
            ? readNodeString(imported, 'value')
            : readNodeString(imported, 'name')
      if (importedName !== undefined) {
        lines.push(`${SCOPE_BINDING}.${localName} = ${moduleVar}[${quoteString(importedName)}]`)
      }
    }
  }
  return `{ ${lines.join('; ')} }`
}

/** Rewrites one top-level declaration statement into scope assignments. */
function rewriteTopLevelDeclaration(statement: Node, edits: SourceEdit[]): void {
  if (statement.type === 'VariableDeclaration') {
    const firstDeclarator = readNodeChildren(statement, 'declarations')[0]
    const firstId = firstDeclarator !== undefined ? readNodeChild(firstDeclarator, 'id') : null
    // A rewritten ObjectPattern declarator is parenthesized and so starts
    // with `(`; an ArrayPattern declarator starts with `[` unchanged. ASI
    // never inserts a semicolon before either, so removing the `let`/`const`
    // keyword outright would let the rewritten line fuse with the previous
    // statement in semicolon-free multi-statement input. A leading `;` is
    // valid in any statement position, so guard those two shapes.
    const needsLeadingSemicolon =
      firstId !== null && (firstId.type === 'ObjectPattern' || firstId.type === 'ArrayPattern')
    // Remove the `let`/`const` keyword (and the whitespace after it); each
    // declarator's binding becomes a scope member so the declaration turns
    // into an assignment.
    edits.push({
      start: statement.start,
      end: firstDeclarator !== undefined ? firstDeclarator.start : statement.start,
      replacement: needsLeadingSemicolon ? ';' : '',
    })

    for (const declarator of readNodeChildren(statement, 'declarations')) {
      const id = readNodeChild(declarator, 'id')
      const init = readNodeChild(declarator, 'init')
      if (id === null) {
        continue
      }
      if (id.type === 'Identifier') {
        const name = readNodeString(id, 'name') ?? ''
        if (init === null) {
          edits.push({
            start: declarator.start,
            end: declarator.end,
            replacement: `${SCOPE_BINDING}.${name} = undefined`,
          })
        } else {
          edits.push({ start: id.start, end: id.end, replacement: `${SCOPE_BINDING}.${name}` })
        }
      } else {
        if (init === null) {
          // Destructuring declarations always have initializers in valid
          // syntax; fail loudly rather than emit broken code.
          throw new ReplTransformError('destructuring declarations need an initializer')
        }
        rewritePatternToMemberExpressions(id, edits)
        if (id.type === 'ObjectPattern') {
          // `{ __runesm.a } = src` at statement position parses as a block;
          // parenthesize the declarator so it stays an assignment.
          edits.push({ start: declarator.start, end: declarator.start, replacement: '(' })
          edits.push({ start: declarator.end, end: declarator.end, replacement: ')' })
        }
      }
    }
    return
  }
  if (statement.type === 'ClassDeclaration') {
    const id = readNodeChild(statement, 'id')
    const name = id !== null ? readNodeString(id, 'name') : undefined
    if (id !== null && name !== undefined) {
      edits.push({ start: statement.start, end: statement.start, replacement: `${SCOPE_BINDING}.${name} = ` })
    }
  }
}

/** Rewrites binding identifiers inside a pattern into scope member expressions. */
function rewritePatternToMemberExpressions(pattern: Node, edits: SourceEdit[]): void {
  switch (pattern.type) {
    case 'Identifier': {
      const name = readNodeString(pattern, 'name')
      if (name !== undefined) {
        edits.push({ start: pattern.start, end: pattern.end, replacement: `${SCOPE_BINDING}.${name}` })
      }
      return
    }
    case 'ObjectPattern':
      for (const property of readNodeChildren(pattern, 'properties')) {
        if (property.type === 'RestElement') {
          // `{ a, ...rest }`: the rest property has no `key`/`value` — it is
          // a RestElement in its own right, handled by the case below.
          rewritePatternToMemberExpressions(property, edits)
          continue
        }
        const key = readNodeChild(property, 'key')
        const value = readNodeChild(property, 'value')
        const shorthand = readNodeBoolean(property, 'shorthand')
        if (shorthand && key !== null) {
          // `{ a }` → `{ a: __runesm.a }`; `{ a = 1 }` → `{ a: __runesm.a = 1 }`.
          // The key and the binding identifier share their source range, so
          // rewriting the key once leaves the rest of the value untouched.
          const keyName = readNodeString(key, 'name')
          if (keyName !== undefined) {
            edits.push({
              start: key.start,
              end: key.end,
              replacement: `${keyName}: ${SCOPE_BINDING}.${keyName}`,
            })
          }
          continue
        }
        if (value !== null) {
          rewritePatternToMemberExpressions(value, edits)
        }
      }
      return
    case 'ArrayPattern':
      for (const element of readNodeChildren(pattern, 'elements')) {
        if (element !== null && isAstNode(element)) {
          rewritePatternToMemberExpressions(element, edits)
        }
      }
      return
    case 'RestElement': {
      const argument = readNodeChild(pattern, 'argument')
      if (argument !== null) {
        rewritePatternToMemberExpressions(argument, edits)
      }
      return
    }
    case 'AssignmentPattern': {
      const left = readNodeChild(pattern, 'left')
      if (left !== null) {
        rewritePatternToMemberExpressions(left, edits)
      }
      return
    }
    default:
      throw new ReplTransformError(`unsupported binding pattern: ${pattern.type}`)
  }
}
