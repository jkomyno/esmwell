import { runJudgeInRealm } from 'src/bootstrap'
import { createDataModuleUrl } from 'src/loader'

const dataModule = (code: string): string => createDataModuleUrl(code)

describe('judge flow end to end in-realm', () => {
  it('runs a module that imports a data-url dependency and judges every case', async () => {
    const helperUrl = dataModule(`export const double = (x) => x * 2\nexport const tag = 'helper'`)
    const solution = `
      import { double, tag } from '${helperUrl}'
      console.info('loading', tag)
      export const solve = (input) => double(input) + 1
      export const identity = (x) => x
    `

    const result = await runJudgeInRealm(solution, {
      cases: [
        { name: 'solves with the helper', exportName: 'solve', args: [20], expected: 41 },
        { name: 'identity passthrough', exportName: 'identity', args: [{ kept: true }], expected: { kept: true } },
        { name: 'identity mismatch', exportName: 'identity', args: [1], expected: 2 },
      ],
    })

    expect(result.status).toBe('fail')
    expect(result.ok).toBe(false)
    expect(result.dependencies).toEqual([])
    expect(result.console).toEqual([{ level: 'info', parts: ['loading', 'helper'] }])
    expect(result.cases.map((testCase) => testCase.status)).toEqual(['pass', 'pass', 'fail'])
    expect(result.cases[2]).toMatchObject({ actual: 1, expected: 2 })
  })

  it('keeps autoInstall off strict about undeclared packages across the full flow', async () => {
    const result = await runJudgeInRealm(`import leftPad from 'left-pad'\nexport const solve = () => 1`, {
      cases: [{ name: 'solve', exportName: 'solve', expected: 1 }],
      autoInstall: false,
    })

    expect(result.status).toBe('error')
    expect(result.error?.message).toContain("could not resolve 'left-pad'")
    expect(result.error?.message).toContain('check the package name or add it to deps')
  })

  it('pins declared dependencies to their exact versions in the surfaced list', async () => {
    const directUrl = dataModule(`export const one = 1`)
    const result = await runJudgeInRealm(`import { one } from '${directUrl}'\nexport const solve = () => one`, {
      cases: [{ name: 'solve', exportName: 'solve', expected: 1 }],
      deps: { 'some-pkg': '9.9.9' },
    })

    expect(result.ok).toBe(true)
    expect(result.dependencies).toEqual([])
  })
})
