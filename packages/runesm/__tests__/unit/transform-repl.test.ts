import { parseUserModule } from 'src/parse'
import { ReplTransformError, transformReplInput } from 'src/transform-repl'

const SCOPE_URL = 'data:text/javascript,scope-module'

const transform = (input: string, options?: { deps?: Record<string, string>; autoInstall?: boolean }): string =>
  transformReplInput(input, parseUserModule(input), { scopeModuleUrl: SCOPE_URL, ...options }).code

const wrap = (body: string): string =>
  [`import { __runesm } from '${SCOPE_URL}'`, 'export const __runesmResult = await (async () => {', body, '})()'].join(
    '\n',
  )

describe('transformReplInput: declarations become scope assignments', () => {
  it.each([
    { name: 'let with initializer', input: 'let count = 0', body: '__runesm.count = 0' },
    { name: 'let without initializer', input: 'let pending', body: '__runesm.pending = undefined' },
    { name: 'const function', input: 'const double = (n) => n * 2', body: '__runesm.double = (n) => n * 2' },
    {
      name: 'function declaration keeps its name',
      input: 'function fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2)\n}',
      body: '__runesm.fib = function fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2)\n}',
    },
    {
      name: 'class declaration keeps its name and live self-reference',
      input: 'class Point {\n  norm() {\n    return new Point()\n  }\n}',
      body: '__runesm.Point = class Point {\n  norm() {\n    return new __runesm.Point()\n  }\n}',
    },
    {
      name: 'object destructuring with renaming and defaults',
      input: 'const { a, b: renamed, c = 3 } = source',
      body: '({ a: __runesm.a, b: __runesm.renamed, c: __runesm.c = 3 } = __runesm.source)',
    },
    {
      name: 'array destructuring with rest',
      input: 'const [first, , third, ...rest] = items',
      body: '[__runesm.first, , __runesm.third, ...__runesm.rest] = __runesm.items',
    },
    {
      name: 'multiple declarators',
      input: 'let one = 1, two = 2',
      body: '__runesm.one = 1, __runesm.two = 2',
    },
  ])('$name', ({ input, body }) => {
    expect(transform(input)).toBe(wrap(body))
  })
})

describe('transformReplInput: references become live scope reads', () => {
  it.each([
    { name: 'free references read the scope', input: 'count + 1', body: 'return __runesm.count + 1' },
    { name: 'update expressions persist', input: 'count++', body: 'return __runesm.count++' },
    {
      name: 'globals fall back through the scope',
      input: "console.log('hi')",
      body: "return __runesm.console.log('hi')",
    },
    {
      name: 'shorthand properties expand',
      input: 'let width = 10\nconst size = { width, height: width * 2 }',
      body: '__runesm.width = 10\n__runesm.size = { width: __runesm.width, height: __runesm.width * 2 }',
    },
    {
      name: 'nested scopes keep their own bindings',
      input: 'function f(a) {\n  return a\n}',
      body: '__runesm.f = function f(a) {\n  return a\n}',
    },
    {
      name: 'loop bindings stay local',
      input: 'for (const item of list) {\n  console.log(item)\n}',
      body: 'for (const item of __runesm.list) {\n  __runesm.console.log(item)\n}',
    },
    {
      name: 'blocks keep their lets local',
      input: '{\n  let inner = 1\n  inner\n}',
      body: '{\n  let inner = 1\n  inner\n}',
    },
    {
      name: 'top-level await passes through',
      input: 'await Promise.resolve(42)',
      body: 'return await __runesm.Promise.resolve(42)',
    },
    { name: 'plain completion value', input: '1 + 1', body: 'return 1 + 1' },
    {
      name: 'no completion for declarations',
      input: 'let stored = 5',
      body: '__runesm.stored = 5',
    },
  ])('$name', ({ input, body }) => {
    expect(transform(input)).toBe(wrap(body))
  })
})

describe('transformReplInput: imports become dynamic assignments', () => {
  it('rewrites default imports', () => {
    expect(transform(`import isEven from 'is-even'`, { deps: { 'is-even': '1.0.0' } })).toBe(
      wrap(
        `{ const __runesm_mod_0 = await import('https://esm.sh/is-even@1.0.0'); __runesm.isEven = __runesm_mod_0.default }`,
      ),
    )
  })

  it('rewrites named imports with access by name', () => {
    expect(transform(`import { shuffle, map as m } from 'lodash-es'`)).toBe(
      wrap(
        `{ const __runesm_mod_0 = await import('https://esm.sh/lodash-es@latest'); __runesm.shuffle = __runesm_mod_0['shuffle']; __runesm.m = __runesm_mod_0['map'] }`,
      ),
    )
  })

  it('rewrites namespace imports', () => {
    expect(transform(`import * as ns from 'pkg'`)).toBe(wrap(`__runesm.ns = await import('https://esm.sh/pkg@latest')`))
  })

  it('rewrites bare side-effect imports', () => {
    expect(transform(`import 'pkg'`)).toBe(wrap(`await import('https://esm.sh/pkg@latest')`))
  })

  it('surfaces resolved dependencies and errors on resolution failure', () => {
    const result = transformReplInput(`import x from 'pkg'`, parseUserModule(`import x from 'pkg'`), {
      scopeModuleUrl: SCOPE_URL,
      deps: { pkg: '1.0.0' },
    })
    expect(result.dependencies).toEqual([
      {
        specifier: 'pkg',
        name: 'pkg',
        version: '1.0.0',
        url: 'https://esm.sh/pkg@1.0.0',
      },
    ])
    expect(() =>
      transformReplInput(`import x from 'undeclared'`, parseUserModule(`import x from 'undeclared'`), {
        scopeModuleUrl: SCOPE_URL,
        autoInstall: false,
      }),
    ).toThrow("could not resolve 'undeclared' — check the package name or add it to deps")
  })

  it('references to imported names become scope reads', () => {
    expect(transform(`import { shuffle } from 'pkg'\nshuffle([1, 2])`)).toBe(
      wrap(
        `{ const __runesm_mod_0 = await import('https://esm.sh/pkg@latest'); __runesm.shuffle = __runesm_mod_0['shuffle'] }\nreturn __runesm.shuffle([1, 2])`,
      ),
    )
  })
})

describe('transformReplInput: rejections', () => {
  it.each(['export const hidden = 1', 'export default function run() {}', `export * from 'pkg'`])(
    'rejects %j',
    (input) => {
      expect(() => transform(input)).toThrow(ReplTransformError)
      expect(() => transform(input)).toThrow(/export statements are not supported in REPL input/)
    },
  )
})
