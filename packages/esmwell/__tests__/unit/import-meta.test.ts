import { applyEdits } from 'src/edits'
import { importMetaMainEdits } from 'src/import-meta'
import { parseUserModule } from 'src/parse'

const rewrite = (code: string, main: boolean): string =>
  applyEdits(code, importMetaMainEdits(code, parseUserModule(code), main))

describe('importMetaMainEdits', () => {
  it.each([
    {
      name: 'a direct read',
      code: `export const main = import.meta.main`,
      expected: `export const main = (import.meta.main = true, import.meta).main`,
    },
    {
      name: 'the object itself, so destructuring and key checks see the property',
      code: `const { main, url } = import.meta\nexport const has = 'main' in import.meta`,
      expected: `const { main, url } = (import.meta.main = true, import.meta)\nexport const has = 'main' in (import.meta.main = true, import.meta)`,
    },
    {
      name: 'a read inside a nested function',
      code: `export const isMain = () => import.meta.main`,
      expected: `export const isMain = () => (import.meta.main = true, import.meta).main`,
    },
  ])('rewrites $name', ({ code, expected }) => {
    expect(rewrite(code, true)).toBe(expected)
  })

  it('writes false for a module that is not the entry', () => {
    expect(rewrite(`if (!import.meta.main) run()`, false)).toBe(
      `if (!(import.meta.main = false, import.meta).main) run()`,
    )
  })

  it('leaves new.target, strings, and comments alone', () => {
    const code = `function F() { return new.target }\nconst text = 'import.meta.main' // import.meta.main`
    expect(rewrite(code, true)).toBe(code)
  })

  it('keeps every line number, including a meta property split across lines', () => {
    const code = `const url = import.meta.url\nexport const main = import\n  .meta.main\nexport const line = 4`
    const rewritten = rewrite(code, true)
    expect(rewritten.split('\n')).toHaveLength(code.split('\n').length)
    expect(rewritten.split('\n')[3]).toBe('export const line = 4')
  })
})
