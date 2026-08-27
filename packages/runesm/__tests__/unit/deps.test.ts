import { collectBareSpecifiers } from 'src/deps'
import { parseUserModule } from 'src/parse'

const specifiersOf = (code: string): string[] => collectBareSpecifiers(parseUserModule(code))

describe('collectBareSpecifiers', () => {
  it.each([
    { code: "import { shuffle } from 'lodash-es'", expected: ['lodash-es'] },
    { code: "import react from 'react'", expected: ['react'] },
    { code: "import * as fs from 'node:fs'", expected: [] },
    { code: "export { readFile } from './local.ts'", expected: [] },
    { code: "export * from 'lodash-es'", expected: ['lodash-es'] },
    { code: "export { default as main } from '@scope/pkg/entry'", expected: ['@scope/pkg/entry'] },
    { code: "const mod = await import('lodash-es')", expected: ['lodash-es'] },
    { code: "function load() { return import('react') }", expected: ['react'] },
    {
      code: "import a from 'pkg-a'\nimport b from 'pkg-b'\nexport { x } from 'pkg-c'",
      expected: ['pkg-a', 'pkg-b', 'pkg-c'],
    },
    { code: "import lunwind from 'node:foo'", expected: [] },
    { code: "import looksNodeIsh from 'node-foo'", expected: ['node-foo'] },
  ])('collects $expected from $code', ({ code, expected }) => {
    expect(specifiersOf(code)).toEqual(expected)
  })

  it('skips non-literal dynamic imports', () => {
    expect(specifiersOf("const name = 'lodash-es'\nconst mod = await import(name)")).toEqual([])
  })

  it('skips url and relative sources', () => {
    expect(
      specifiersOf(`
        import a from 'https://cdn.example.com/a.mjs'
        import b from 'data:text/javascript,export default 1'
        import c from './sibling.ts'
        import d from '../parent.ts'
        import e from '/absolute.ts'
      `),
    ).toEqual([])
  })

  it('deduplicates while preserving first-seen order', () => {
    expect(
      specifiersOf(`
        import { a } from 'pkg-a'
        import { b } from 'pkg-b'
        const mod = await import('pkg-a')
        export { c } from 'pkg-a'
      `),
    ).toEqual(['pkg-a', 'pkg-b'])
  })

  it('ignores import-like strings in literals and member calls', () => {
    expect(specifiersOf("const label = 'import x from y'\nship.import('pkg')")).toEqual([])
  })
})
