import { createReplSessionInRealm } from 'src/bootstrap'
import { createDataModuleUrl } from 'src/loader'

describe('REPL flow end to end in-realm', () => {
  it('persists declarations, imports, and closures across inputs', async () => {
    const session = createReplSessionInRealm({})
    const helperUrl = createDataModuleUrl(`export const double = (x) => x * 2\nexport const tag = 'helper'`)

    const imported = await session.evaluate(`import { double, tag } from '${helperUrl}'\nconsole.info('loaded', tag)`)
    expect(imported.ok).toBe(true)
    expect(imported.dependencies).toEqual([])
    expect(imported.console).toEqual([{ level: 'info', parts: ['loaded', 'helper'] }])

    await session.evaluate('let base = 20')
    const computed = await session.evaluate('const result = double(base) + 2\nresult')
    expect(computed.value).toBe(42)

    await session.evaluate('const observe = () => result')
    await session.evaluate('result = 100')
    const observed = await session.evaluate('observe()')
    expect(observed.value).toBe(100)
  })

  it('keeps autoInstall strictness across the whole flow', async () => {
    const session = createReplSessionInRealm({ autoInstall: false })

    const failed = await session.evaluate(`import isEven from 'is-even'`)
    expect(failed.ok).toBe(false)
    expect(failed.error?.message).toContain("could not resolve 'is-even'")

    const recovered = await session.evaluate('1 + 1')
    expect(recovered.value).toBe(2)
  })
})
