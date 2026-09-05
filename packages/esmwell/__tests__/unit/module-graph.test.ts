import { materializeModuleGraph } from 'src/module-graph'

const SCOPE = 'https://example.test/assets/'

/** Captures what the graph writes to Cache Storage, keyed by module URL. */
const stubCaches = (): Map<string, string> => {
  const stored = new Map<string, string>()
  const cache = {
    put: async (url: string, response: Response): Promise<void> => {
      stored.set(url, await response.text())
    },
  }
  vi.stubGlobal('caches', {
    open: vi.fn<() => Promise<typeof cache>>(() => Promise.resolve(cache)),
    delete: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  })
  return stored
}

const moduleBody = (stored: Map<string, string>, id: string): string => {
  const url = [...stored.keys()].find((key) => key.endsWith(`/${id}.mjs`))
  if (url === undefined) throw new Error(`module '${id}' was not stored: ${[...stored.keys()].join(', ')}`)
  return stored.get(url) ?? ''
}

describe('materializeModuleGraph: import.meta.main', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks the entry and its same-source extension aliases as main, and every other module as not main', async () => {
    const stored = stubCaches()
    const entrySource = `export const main = import.meta.main`
    const utilSource = `export const utilMain = import.meta.main`
    const graph = await materializeModuleGraph({
      modules: {
        'src/main': entrySource,
        'src/main.js': entrySource,
        'src/main.cjs': entrySource,
        'src/main.mjs': `export const main = import.meta.main // a different program that shares the stem`,
        'src/util': utilSource,
        'src/util.js': utilSource,
      },
      entries: ['src/main'],
      graphId: 'abc123',
      serviceWorkerScope: SCOPE,
    })

    expect(moduleBody(stored, 'src/main')).toBe(`export const main = (import.meta.main = true, import.meta).main`)
    expect(moduleBody(stored, 'src/main.js')).toBe(`export const main = (import.meta.main = true, import.meta).main`)
    expect(moduleBody(stored, 'src/main.cjs')).toContain('import.meta.main = true')
    expect(moduleBody(stored, 'src/main.mjs')).toContain(`(import.meta.main = false, import.meta).main`)
    expect(moduleBody(stored, 'src/util')).toBe(`export const utilMain = (import.meta.main = false, import.meta).main`)
    expect(moduleBody(stored, 'src/util.js')).toBe(
      `export const utilMain = (import.meta.main = false, import.meta).main`,
    )
    expect(graph.entryUrls).toEqual([`${SCOPE}__esmwell_graphs__/v1/abc123/src/main.mjs`])
  })

  it('marks every test entry of a workspace as main', async () => {
    const stored = stubCaches()
    await materializeModuleGraph({
      modules: {
        'src/impl': `export const implMain = import.meta.main`,
        'tests/a.test': `export const aMain = import.meta.main`,
        'tests/b.test': `export const bMain = import.meta.main`,
      },
      entries: ['tests/a.test', 'tests/b.test'],
      graphId: 'abc123',
      serviceWorkerScope: SCOPE,
    })

    expect(moduleBody(stored, 'src/impl')).toContain('import.meta.main = false')
    expect(moduleBody(stored, 'tests/a.test')).toContain('import.meta.main = true')
    expect(moduleBody(stored, 'tests/b.test')).toContain('import.meta.main = true')
  })
})
