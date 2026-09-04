import { browserProcessModuleUrl, createBrowserProcess } from 'src/browser-process'

describe('browser process compatibility', () => {
  it('exposes the exact frozen facade surface without claiming Node', () => {
    const process = createBrowserProcess()

    expect(Object.keys(process).toSorted()).toEqual([
      'addListener',
      'argv',
      'browser',
      'chdir',
      'cwd',
      'emit',
      'env',
      'nextTick',
      'off',
      'on',
      'once',
      'removeListener',
      'title',
      'version',
      'versions',
    ])
    expect(Object.isFrozen(process)).toBe(true)
    expect(Reflect.set(process, 'title', 'node')).toBe(false)
    expect(process).toMatchObject({
      browser: true,
      title: 'browser',
      env: {},
      argv: [],
      version: '',
      versions: {},
    })
    expect(Reflect.get(process, 'platform')).toBeUndefined()
    expect(process.versions.node).toBeUndefined()
  })

  it('keeps env and argv mutable without Node environment coercion', () => {
    const process = createBrowserProcess()

    process.env.ESMWELL_MODE = 'browser'
    Reflect.set(process.env, 'ESMWELL_NUMBER', 42)
    process.argv.push('input.js', '--inspect')

    expect(process.env).toEqual({ ESMWELL_MODE: 'browser', ESMWELL_NUMBER: 42 })
    expect(process.argv).toEqual(['input.js', '--inspect'])
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
    expect(process.cwd()).toBe('/')
    expect(() => process.chdir('/tmp')).toThrow("process.chdir('/tmp') is not supported")
    expect(process.cwd()).toBe('/')
  })

  it('keeps EventEmitter-shaped methods inert', () => {
    const process = createBrowserProcess()
    let listenerCalled = false
    const listener = (): void => {
      listenerCalled = true
    }

    for (const method of ['on', 'once', 'off', 'addListener', 'removeListener'] as const) {
      expect(process[method]('esmwell', listener)).toBe(process)
    }
    expect(process.emit('esmwell', 1)).toBe(false)
    expect(listenerCalled).toBe(false)
  })

  it('builds a data-url module facade over globalThis.process', () => {
    const url = browserProcessModuleUrl()
    expect(url).toMatch(/^data:text\/javascript;charset=utf-8,/)
    const source = decodeURIComponent(url)
    expect(source).toContain('export { process }')
    expect(source).toContain('export default process')
    for (const name of [
      'browser',
      'title',
      'env',
      'argv',
      'version',
      'versions',
      'platform',
      'cwd',
      'chdir',
      'nextTick',
    ]) {
      expect(source).toContain(`export const ${name} = process.${name}`)
    }
  })
})
