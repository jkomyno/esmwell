import { assertCanonicalModuleId, testGraphCacheName } from 'src/test-workspace'

describe('test workspace identifiers', () => {
  it.each(['src/impl', 'tests/impl.test', '@scope/local'])('accepts canonical module id %s', (id) => {
    expect(() => assertCanonicalModuleId(id)).not.toThrow()
  })

  it.each(['', '/src/impl', 'src/../impl', 'src//impl', 'src\\impl', 'src/impl?raw'])('rejects invalid id %s', (id) => {
    expect(() => assertCanonicalModuleId(id)).toThrow(/invalid virtual module id/)
  })

  it('derives the service-worker cache name from a graph id', () => {
    expect(testGraphCacheName('abc-123')).toBe('esmwell:test-graph:v1:abc-123')
  })
})
