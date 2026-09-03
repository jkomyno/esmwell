import { parseUserModule } from 'src/parse'
import { SpecifierResolutionError } from 'src/resolve'
import type { ResolveOptions } from 'src/resolve'
import { transformJudgeModule } from 'src/transform-judge'

interface RewriteCase {
  name: string
  code: string
  options: ResolveOptions
  expected: string
}

const transform = (code: string, options?: ResolveOptions): string =>
  transformJudgeModule(code, parseUserModule(code), options ?? {}).code

const rewriteCases: RewriteCase[] = [
  {
    name: 'static imports',
    code: `import { shuffle } from 'lodash-es'\nconst x = shuffle([1])`,
    options: { deps: { 'lodash-es': '4.17.21' } },
    expected: `import { shuffle } from 'https://esm.sh/lodash-es@4.17.21'\nconst x = shuffle([1])`,
  },
  {
    name: 'default and namespace imports',
    code: `import react from 'react'\nimport * as pkg from '@scope/pkg'`,
    options: {},
    expected: `import react from 'https://esm.sh/react@latest'\nimport * as pkg from 'https://esm.sh/@scope/pkg@latest'`,
  },
  {
    name: 'bare side-effect import',
    code: `import 'pkg-a'\nexport const kept = 1`,
    options: {},
    expected: `import 'https://esm.sh/pkg-a@latest'\nexport const kept = 1`,
  },
  {
    name: 'export … from',
    code: `export { map } from 'lodash-es'`,
    options: { deps: { 'lodash-es': '4.17.21' } },
    expected: `export { map } from 'https://esm.sh/lodash-es@4.17.21'`,
  },
  {
    name: 'export * from',
    code: `export * from 'pkg'`,
    options: {},
    expected: `export * from 'https://esm.sh/pkg@latest'`,
  },
  {
    name: 'literal dynamic import',
    code: `const mod = await import('pkg/entry')`,
    options: { deps: { pkg: '1.0.0' } },
    expected: `const mod = await import('https://esm.sh/pkg@1.0.0/entry')`,
  },
  {
    name: 'absolute url passthrough',
    code: `import a from 'https://cdn.example.com/a.mjs'\nconst b = await import('data:text/javascript,export default 1')`,
    options: {},
    expected: `import a from 'https://cdn.example.com/a.mjs'\nconst b = await import('data:text/javascript,export default 1')`,
  },
  {
    name: 'non-literal dynamic import untouched',
    code: `const name = 'pkg'\nconst mod = await import(name)`,
    options: {},
    expected: `const name = 'pkg'\nconst mod = await import(name)`,
  },
  {
    name: 'import-looking strings and comments untouched',
    code: `// import x from 'pkg'\nconst label = "export { y } from 'pkg'"\nconst re = /import 'pkg'/`,
    options: {},
    expected: `// import x from 'pkg'\nconst label = "export { y } from 'pkg'"\nconst re = /import 'pkg'/`,
  },
  {
    name: 'multiple edits keep surrounding code intact',
    code: `import { a } from 'pkg-a'\n\nconst middle = 'untouched'\n\nexport { b } from 'pkg-b'\nconst late = await import('pkg-c')`,
    options: {},
    expected: `import { a } from 'https://esm.sh/pkg-a@latest'\n\nconst middle = 'untouched'\n\nexport { b } from 'https://esm.sh/pkg-b@latest'\nconst late = await import('https://esm.sh/pkg-c@latest')`,
  },
]

describe('transformJudgeModule: specifier rewriting', () => {
  it.each(rewriteCases)('$name', ({ code, options, expected }) => {
    expect(transform(code, options)).toBe(expected)
  })
})

describe('transformJudgeModule: failures', () => {
  it('throws on relative specifiers', () => {
    expect(() => transform(`import { x } from './sibling.ts'`)).toThrow(SpecifierResolutionError)
  })

  it('throws on node modules', () => {
    expect(() => transform(`import fs from 'node:fs'`)).toThrow(/IndexedDB|browser/)
  })

  it('throws on undeclared packages when autoInstall is off', () => {
    expect(() => transform(`import x from 'pkg'`, { autoInstall: false })).toThrow(
      "could not resolve 'pkg' — check the package name or add it to deps",
    )
  })
})

describe('transformJudgeModule: dependency surfacing', () => {
  it('surfaces resolved dependencies in order, deduplicated', () => {
    const code = `import { a } from 'pkg-a'\nimport { b } from 'pkg-b'\nconst again = await import('pkg-a')`
    const result = transformJudgeModule(code, parseUserModule(code), { deps: { 'pkg-a': '1.0.0' } })
    expect(result.dependencies).toEqual([
      {
        specifier: 'pkg-a',
        name: 'pkg-a',
        version: '1.0.0',
        url: 'https://esm.sh/pkg-a@1.0.0',
      },
      {
        specifier: 'pkg-b',
        name: 'pkg-b',
        version: 'latest',
        url: 'https://esm.sh/pkg-b@latest',
      },
    ])
  })

  it('surfaces nothing for url-only imports', () => {
    const code = `import a from 'https://cdn.example.com/a.mjs'`
    const result = transformJudgeModule(code, parseUserModule(code), {})
    expect(result.dependencies).toEqual([])
  })
})
