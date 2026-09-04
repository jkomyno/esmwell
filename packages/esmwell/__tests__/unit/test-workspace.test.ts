import { assertCanonicalModuleId, moduleGraphCacheName } from 'src/module-graph'
import { materializeTestGraph } from 'src/test-workspace'

describe('test workspace identifiers', () => {
  it.each(['src/impl', 'tests/impl.test', '@scope/local'])('accepts canonical module id %s', (id) => {
    expect(() => assertCanonicalModuleId(id)).not.toThrow()
  })

  it.each(['', '/src/impl', 'src/../impl', 'src//impl', 'src\\impl', 'src/impl?raw'])('rejects invalid id %s', (id) => {
    expect(() => assertCanonicalModuleId(id)).toThrow(/invalid virtual module id/)
  })

  it('derives the service-worker cache name from a graph id', () => {
    expect(moduleGraphCacheName('abc-123')).toBe('esmwell:test-graph:v1:abc-123')
  })

  it('ignores prototype-inherited test aliases when resolving packages', async () => {
    const sources = new Map<string, string>()
    const deleteCache = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true))
    vi.stubGlobal('caches', {
      open: () =>
        Promise.resolve({
          put: async (url: string, response: Response): Promise<void> => {
            sources.set(url, await response.text())
          },
        }),
      delete: deleteCache,
    })
    try {
      const graph = await materializeTestGraph({
        engine: 'vitest',
        modules: { 'tests/main': `import value from 'constructor'\nexpect(value).toBeDefined()` },
        testFiles: ['tests/main'],
        graphId: 'abc-123',
        serviceWorkerScope: 'https://example.test/',
        deps: { constructor: '1.0.0' },
        autoInstall: false,
      })

      expect([...sources.values()]).toContainEqual(expect.stringContaining('https://esm.sh/constructor@1.0.0'))
      await graph.cleanup()
      expect(deleteCache).toHaveBeenCalledWith('esmwell:test-graph:v1:abc-123')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
