import { parseUserModule } from 'src/parse'
import { checkPolicy, PolicyViolation } from 'src/policy'

const violationsOf = (code: string): PolicyViolation[] => checkPolicy(parseUserModule(code))

describe('policy gate: var declarations', () => {
  it.each([
    { code: 'var x = 1', line: 1 },
    { code: 'function f() { var y = 2 }', line: 1 },
    { code: 'if (a) { var z = 3 }', line: 1 },
    { code: 'for (var i = 0; i < 3; i++) {}', line: 1 },
    { code: 'for (var k in obj) {}', line: 1 },
    { code: 'for (var v of list) {}', line: 1 },
    { code: 'export var e = 1', line: 1 },
    { code: 'const a = 1\nvar b = 2', line: 2 },
    { code: 'const a = 1\n\nconst c = 3\n  var d = 4', line: 4 },
  ])('rejects $code', ({ code, line }) => {
    const violations = violationsOf(code)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('var')
    expect(violations[0]?.line).toBe(line)
    expect(violations[0]?.message).toContain('use let or const')
  })

  it.each([
    'let x = 1',
    'const y = 2',
    'function f() { let z = 3 }',
    'for (let i = 0; i < 3; i++) {}',
    'for (const k in obj) {}',
    'for (const v of list) {}',
    'export const e = 5',
  ])('allows %j', (code) => {
    expect(violationsOf(code)).toEqual([])
  })
})

describe('policy gate: eval references', () => {
  it.each([
    { code: "eval('1 + 1')", line: 1 },
    { code: 'const e = eval', line: 1 },
    { code: 'const o = { eval }', line: 1 },
    { code: 'const o = { f: eval }', line: 1 },
    { code: 'const o = { [eval]: 1 }', line: 1 },
    { code: 'const a = 1\ncall(eval)', line: 2 },
  ])('rejects $code', ({ code, line }) => {
    const violations = violationsOf(code)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('eval')
    expect(violations[0]?.line).toBe(line)
  })

  it.each([
    'const o = { eval: 1 }',
    'const v = obj.eval',
    'const w = obj?.eval',
    'obj.eval = 2',
    'class A { eval() {} }',
    'class A { static eval = 1 }',
    'import { eval as readIt } from "some-module"',
    'eval: for (;;) { break eval }',
  ])('allows %j', (code) => {
    expect(violationsOf(code)).toEqual([])
  })
})

describe('policy gate: Function constructor', () => {
  it.each([
    { code: "Function('return 1')", line: 1 },
    { code: 'new Function("a", "return a")', line: 1 },
    { code: 'const a = 1\nconst f = new Function("b")', line: 2 },
  ])('rejects $code', ({ code, line }) => {
    const violations = violationsOf(code)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.rule).toBe('function-constructor')
    expect(violations[0]?.line).toBe(line)
  })

  it.each([
    'a.Function()',
    'new a.Function("x")',
    'const captured = Function',
    'function Function() {}',
    'const fn = someFunction()',
  ])('allows %j', (code) => {
    expect(violationsOf(code)).toEqual([])
  })
})

describe('policy gate: combined', () => {
  it('reports every violation in source order', () => {
    const violations = violationsOf('var x = 1\neval("y")\nconst f = Function("z")')
    expect(violations.map((violation) => violation.rule)).toEqual(['var', 'eval', 'function-constructor'])
  })

  it('messages carry line numbers', () => {
    const [violation] = violationsOf('const a = 1\nvar b = 2')
    expect(violation?.message).toContain('line 2')
  })
})
