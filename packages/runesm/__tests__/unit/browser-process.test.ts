import { browserProcessModuleUrl, createBrowserProcess } from 'src/browser-process'

describe('browser process compatibility', () => {
  it('exposes browser identity and a stable virtual cwd without claiming Node', () => {
    const process = createBrowserProcess()

    expect(process.browser).toBe(true)
    expect(process.cwd()).toBe('/')
    expect(process.env).toEqual({})
    expect(process.argv).toEqual([])
    expect(process.versions.node).toBeUndefined()
  })

  it('schedules nextTick callbacks as microtasks', async () => {
    const process = createBrowserProcess()
    const events = ['sync']

    process.nextTick((value) => events.push(String(value)), 'tick')
    expect(events).toEqual(['sync'])
    await Promise.resolve()
    expect(events).toEqual(['sync', 'tick'])
  })

  it('rejects changing the virtual cwd', () => {
    const process = createBrowserProcess()
    expect(() => process.chdir('/tmp')).toThrow("process.chdir('/tmp') is not supported")
  })

  it('builds a data-url module facade over globalThis.process', () => {
    const url = browserProcessModuleUrl()
    expect(url).toMatch(/^data:text\/javascript;charset=utf-8,/)
    expect(decodeURIComponent(url)).toContain('export default process')
  })
})
