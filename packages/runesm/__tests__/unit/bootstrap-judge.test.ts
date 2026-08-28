import { explainModuleLoadError, runJudgeInRealm } from 'src/bootstrap'
import type { JudgeCase, JudgeRunResult } from 'src/types'

interface JudgeRunOptions {
  deps?: Record<string, string>
  autoInstall?: boolean
}

const runJudge = async (code: string, cases: JudgeCase[], options?: JudgeRunOptions): Promise<JudgeRunResult> =>
  runJudgeInRealm(code, { cases, ...options })

describe('runJudgeInRealm: case outcomes', () => {
  it('passes matching cases and fails mismatches with actual and expected', async () => {
    const result = await runJudge(`export const solve = () => 42\nexport const greet = (name) => 'hi ' + name`, [
      { name: 'solve', exportName: 'solve', expected: 42 },
      { name: 'greet', exportName: 'greet', args: ['ada'], expected: 'hi bob' },
    ])

    expect(result.status).toBe('fail')
    expect(result.ok).toBe(false)
    expect(result.cases[0]).toMatchObject({ name: 'solve', status: 'pass' })
    expect(result.cases[1]).toMatchObject({
      name: 'greet',
      status: 'fail',
      actual: 'hi ada',
      expected: 'hi bob',
    })
  })

  it('passes cases without expectations when the export does not throw', async () => {
    const result = await runJudge(`export const ping = () => { /* side effect only */ }`, [
      { name: 'ping', exportName: 'ping' },
    ])
    expect(result.cases[0]).toMatchObject({ status: 'pass' })
    expect('actual' in (result.cases[0] ?? {}) && 'expected' in (result.cases[0] ?? {})).toBe(false)
  })

  it('compares against an explicit undefined expectation', async () => {
    const result = await runJudge(`export const nothing = () => undefined`, [
      { name: 'nothing', exportName: 'nothing', expected: undefined },
    ])
    expect(result.cases[0]?.status).toBe('pass')
  })

  it('fails an explicit undefined expectation against a non-undefined return, unlike an omitted expectation', async () => {
    const result = await runJudge(`export const something = () => 1`, [
      { name: 'explicit', exportName: 'something', expected: undefined },
      { name: 'omitted', exportName: 'something' },
    ])
    expect(result.cases[0]).toMatchObject({ name: 'explicit', status: 'fail', actual: 1 })
    expect(result.cases[0]).toHaveProperty('expected', undefined)
    expect(result.cases[1]).toMatchObject({ name: 'omitted', status: 'pass' })
  })

  it('awaits async exports', async () => {
    const result = await runJudge(`export const slow = async () => { await Promise.resolve(); return 'done' }`, [
      { name: 'slow', exportName: 'slow', expected: 'done' },
    ])
    expect(result.cases[0]?.status).toBe('pass')
  })

  it('reports throwing solutions as case errors', async () => {
    const result = await runJudge(`export const boom = () => { throw new TypeError('bad input') }`, [
      { name: 'boom', exportName: 'boom', expected: 1 },
    ])

    expect(result.cases[0]?.status).toBe('error')
    expect(result.cases[0]?.error).toMatchObject({ name: 'TypeError', message: 'bad input' })
    expect(result.cases[0]?.error?.stack).toContain('bad input')
  })

  it('reports missing exports with the available ones', async () => {
    const result = await runJudge(`export const solve = () => 1\nexport const other = 2`, [
      { name: 'missing', exportName: 'absent', expected: 1 },
    ])

    expect(result.cases[0]?.status).toBe('error')
    expect(result.cases[0]?.error?.message).toContain("could not find export 'absent'")
    expect(result.cases[0]?.error?.message).toContain('available exports: other, solve')
  })

  it('reports non-function exports', async () => {
    const result = await runJudge(`export const value = 3`, [{ name: 'value', exportName: 'value' }])
    expect(result.cases[0]?.status).toBe('error')
    expect(result.cases[0]?.error?.message).toContain("export 'value' is not a function")
  })

  it('deep-equals structured results', async () => {
    const result = await runJudge(`export const summary = () => new Map([['total', 3], ['items', new Set([1, 2])]])`, [
      {
        name: 'summary',
        exportName: 'summary',
        expected: new Map<string, unknown>([
          ['items', new Set([2, 1])],
          ['total', 3],
        ]),
      },
    ])
    expect(result.cases[0]?.status).toBe('pass')
  })
})

describe('runJudgeInRealm: module-level failures', () => {
  it('reports syntax errors with position information', async () => {
    const result = await runJudge('const a = {', [])
    expect(result.status).toBe('error')
    expect(result.ok).toBe(false)
    expect(result.error).toMatchObject({ name: 'UserSyntaxError', line: 1, column: 11 })
    expect(result.error?.message).toMatch(/line 1/)
  })

  it('reports policy violations without running the module, with the rule and line intact', async () => {
    const result = await runJudge('var leaked = 1\nexport const solve = () => leaked', [
      { name: 'solve', exportName: 'solve', expected: 1 },
    ])
    expect(result.status).toBe('error')
    expect(result.error?.message).toContain('var declarations are not allowed')
    expect(result.error).toMatchObject({ name: 'PolicyViolation', rule: 'var', line: 1 })
    expect(result.cases).toEqual([])
  })

  it('reports resolution failures for undeclared packages under autoInstall off, with the kind and specifier intact', async () => {
    const result = await runJudge(
      `import _ from 'lodash-es'\nexport const solve = () => 1`,
      [{ name: 'solve', exportName: 'solve', expected: 1 }],
      { autoInstall: false },
    )
    expect(result.status).toBe('error')
    expect(result.error?.message).toContain("could not resolve 'lodash-es'")
    expect(result.error).toMatchObject({
      name: 'SpecifierResolutionError',
      kind: 'undeclared',
      specifier: 'lodash-es',
    })
  })

  it('reports module evaluation errors', async () => {
    const result = await runJudge(`throw new Error('module initialization failed')`, [])
    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({ name: 'Error', message: 'module initialization failed' })
  })
})

describe('module dependency load errors', () => {
  const dependency = {
    specifier: '@napi-rs/canvas@1.0.8',
    name: '@napi-rs/canvas',
    version: '1.0.8',
    url: 'https://esm.sh/@napi-rs/canvas@1.0.8',
  }

  it('restores package context for an opaque browser module failure', () => {
    const browserError = new TypeError('Importing a module script failed.')
    const explained = explainModuleLoadError(browserError, [dependency])

    expect(explained).toMatchObject({
      name: 'DependencyLoadError',
      cause: browserError,
      message: expect.stringContaining("'@napi-rs/canvas@1.0.8'"),
    })
    expect(explained).toMatchObject({
      message: expect.stringContaining('Node-API addons cannot run in a browser worker'),
    })
  })

  it('preserves actionable package evaluation errors', () => {
    const packageError = new Error('module initialization failed')

    expect(explainModuleLoadError(packageError, [dependency])).toBe(packageError)
  })
})

describe('runJudgeInRealm: console capture', () => {
  it('captures console output in order across module and cases', async () => {
    const result = await runJudge(
      `console.log('module start')\nexport const solve = () => { console.warn('case ran'); return 1 }`,
      [{ name: 'solve', exportName: 'solve', expected: 1 }],
    )

    expect(result.ok).toBe(true)
    expect(result.console).toEqual([
      { level: 'log', parts: ['module start'] },
      { level: 'warn', parts: ['case ran'] },
    ])
  })

  it('restores the console after the run', async () => {
    await runJudge(`console.log('during run')`, [])

    const seen: string[] = []
    const { installConsoleCapture } = await import('src/console')
    const restore = installConsoleCapture({
      write: (chunk) => {
        seen.push(chunk.parts.join(' '))
      },
    })
    console.log('after run')
    restore()
    expect(seen).toEqual(['after run'])
  })
})

describe('runJudgeInRealm: dependency surfacing', () => {
  it('resolves url imports without bare dependencies', async () => {
    const dependencyUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent('export const double = (x) => x * 2')}`
    const result = await runJudge(`import { double } from '${dependencyUrl}'\nexport const solve = () => double(21)`, [
      { name: 'solve', exportName: 'solve', expected: 42 },
    ])

    expect(result.ok).toBe(true)
    expect(result.dependencies).toEqual([])
  })
})
