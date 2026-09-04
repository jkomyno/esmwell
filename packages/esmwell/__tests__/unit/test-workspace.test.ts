import { assertCanonicalModuleId, moduleGraphCacheName } from 'src/module-graph'

describe('test workspace identifiers', () => {
  it.each(['src/impl', 'tests/impl.test', '@scope/local'])('accepts canonical module id %s', (id) => {
    expect(() => assertCanonicalModuleId(id)).not.toThrow()
  })

  it.each(['', '/src/impl', 'src/../impl', 'src//impl', 'src\\impl', 'src/impl?raw'])('rejects invalid id %s', (id) => {
    expect(() => assertCanonicalModuleId(id)).toThrow(/invalid virtual module id/)
  })

  it('derives the service-worker cache name from a graph id', () => {
    expect(moduleGraphCacheName('abc-123')).toBe('esmwell:module-graph:v1:abc-123')
  })
})
