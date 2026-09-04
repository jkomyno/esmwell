import { parseUserModule, UserSyntaxError } from 'src/parse'

const captureError = (run: () => void): unknown => {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('parseUserModule', () => {
  it.each([
    'const answer = 42',
    'import { readFile } from "fs"',
    'export function solve() { return 1 }',
    'const delayed = await Promise.resolve(1)',
    '#!/usr/bin/env node\nconst shebang = true',
    'export * from "some-module"',
    'const nested = { a: [1, 2, { b: new Set([1n, 2n]) }] }',
  ])('parses %j', (code) => {
    const ast = parseUserModule(code)
    expect(ast.type).toBe('Program')
    expect(ast.sourceType).toBe('module')
  })

  it('parses with source locations on nodes', () => {
    const ast = parseUserModule('const first = 1\nconst second = 2')
    expect(ast.loc?.start.line).toBe(1)
    const secondDeclaration = ast.body[1]
    expect(secondDeclaration?.loc?.start.line).toBe(2)
  })

  it.each([
    { code: 'const a = {', line: 1, column: 11 },
    { code: 'const a = 1\nconst b = 2\nlet @ = 3', line: 3, column: 4 },
    { code: 'const a = 1\n\n\nfunction f( {', line: 4, column: 13 },
  ])('throws UserSyntaxError for $code', ({ code, line, column }) => {
    const caught = captureError(() => {
      parseUserModule(code)
    })

    expect(caught).toBeInstanceOf(UserSyntaxError)
    const error = caught as UserSyntaxError
    expect(error.line).toBe(line)
    expect(error.column).toBe(column)
    expect(error.message).toContain(`line ${line}, column ${column + 1}`)
  })

  it('rejects module-illegal syntax that scripts allow', () => {
    const caught = captureError(() => {
      parseUserModule('with (obj) { x = 1 }')
    })
    expect(caught).toBeInstanceOf(UserSyntaxError)
  })

  it('rejects strict-mode-illegal bindings and assignments', () => {
    for (const code of ['let eval = 1', 'eval = 5']) {
      const caught = captureError(() => {
        parseUserModule(code)
      })
      expect(caught).toBeInstanceOf(UserSyntaxError)
    }
  })
})
