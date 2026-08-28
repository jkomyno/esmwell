import { createReplSessionInRealm } from 'src/bootstrap'
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
      // Leading `;` guards against ASI fusing this with a preceding
      // semicolon-free statement: a rewritten ObjectPattern declarator is
      // parenthesized, so the line would otherwise start with `(`.
      body: ';({ a: __runesm.a, b: __runesm.renamed, c: __runesm.c = 3 } = __runesm.source)',
    },
    {
      name: 'array destructuring with rest',
      input: 'const [first, , third, ...rest] = items',
      // Same ASI guard: the rewritten line starts with `[`.
      body: ';[__runesm.first, , __runesm.third, ...__runesm.rest] = __runesm.items',
    },
    {
      name: 'object rest destructuring',
      input: 'const { a, ...rest } = source',
      body: ';({ a: __runesm.a, ...__runesm.rest } = __runesm.source)',
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
    expect(transform(`import * as ns from 'pkg'`)).toBe(
      wrap(`{ const __runesm_mod_0 = await import('https://esm.sh/pkg@latest'); __runesm.ns = __runesm_mod_0 }`),
    )
  })

  it('rewrites a mixed default and namespace import without dropping the default binding', () => {
    expect(transform(`import def, * as ns from 'pkg'`)).toBe(
      wrap(
        `{ const __runesm_mod_0 = await import('https://esm.sh/pkg@latest'); __runesm.def = __runesm_mod_0.default; __runesm.ns = __runesm_mod_0 }`,
      ),
    )
  })

  it('rewrites a string-literal imported binding name', () => {
    expect(transform(`import { "a-b" as ab } from 'pkg'`)).toBe(
      wrap(`{ const __runesm_mod_0 = await import('https://esm.sh/pkg@latest'); __runesm.ab = __runesm_mod_0['a-b'] }`),
    )
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

describe('transformReplInput: ASI safety in semicolon-free multi-statement input', () => {
  it('does not fuse an array-pattern declaration into the previous statement', () => {
    // Without a leading `;`, `1\n[__runesm.a] = [2]` parses as `1[__runesm.a]
    // = [2]` — a computed member assignment on the number literal, not two
    // statements.
    expect(transform('let f = () => 1\nlet [a] = [2]')).toBe(wrap('__runesm.f = () => 1\n;[__runesm.a] = [2]'))
  })

  it('does not fuse an object-pattern declaration into the previous statement', () => {
    expect(transform('let g = () => 1\nlet { a } = { a: 2 }')).toBe(
      wrap('__runesm.g = () => 1\n;({ a: __runesm.a } = { a: 2 })'),
    )
  })
})

describe('transformReplInput: function declarations hoist', () => {
  it('emits a single top-level function ahead of a call that precedes it', () => {
    expect(transform('f()\nfunction f() {\n  return 1\n}')).toBe(
      wrap('__runesm.f = function f() {\n  return 1\n}\n__runesm.f()'),
    )
  })

  it('lets mutually calling top-level functions reference each other regardless of order', () => {
    expect(transform('a()\nb()\nfunction a() {\n  return b()\n}\nfunction b() {\n  return 1\n}')).toBe(
      wrap(
        '__runesm.a = function a() {\n  return __runesm.b()\n}\n__runesm.b = function b() {\n  return 1\n}\n__runesm.a()\n__runesm.b()',
      ),
    )
  })

  it('keeps class declarations in place (no hoisting) since class bindings are in the temporal dead zone', () => {
    expect(transform('class Point {\n  norm() {\n    return new Point()\n  }\n}')).toBe(
      wrap('__runesm.Point = class Point {\n  norm() {\n    return new __runesm.Point()\n  }\n}'),
    )
  })
})

describe('transformReplInput: assignment-position and computed-key patterns', () => {
  it('rewrites a cover-initialized shorthand property in assignment destructuring', () => {
    expect(transform('({ a = 1 } = obj)')).toBe(wrap('return ({ a: __runesm.a = 1 } = __runesm.obj)'))
  })

  it('rewrites the key expression of a computed destructuring property', () => {
    expect(transform('const { [k]: v } = o')).toBe(wrap(';({ [__runesm.k]: __runesm.v } = __runesm.o)'))
  })
})

describe('REPL execution: rewrites hold under real evaluation, not just generated text', () => {
  it('a semicolon-free array-pattern declaration does not corrupt the previous line and both bindings persist', async () => {
    const session = createReplSessionInRealm({})
    const result = await session.evaluate('let f = () => 1\nlet [a] = [2]')
    expect(result.ok).toBe(true)

    const fRead = await session.evaluate('f()')
    const aRead = await session.evaluate('a')
    expect(fRead.value).toBe(1)
    expect(aRead.value).toBe(2)
  })

  it('a semicolon-free object-pattern declaration does not corrupt the previous line and both bindings persist', async () => {
    const session = createReplSessionInRealm({})
    const result = await session.evaluate('let g = () => 1\nlet { a } = { a: 2 }')
    expect(result.ok).toBe(true)

    const gRead = await session.evaluate('g()')
    const aRead = await session.evaluate('a')
    expect(gRead.value).toBe(1)
    expect(aRead.value).toBe(2)
  })

  it('object rest destructuring assigns and persists the rest object', async () => {
    const session = createReplSessionInRealm({})
    const declared = await session.evaluate('const { a, ...rest } = { a: 1, b: 2, c: 3 }')
    expect(declared.ok).toBe(true)

    const restRead = await session.evaluate('rest')
    expect(restRead.value).toEqual({ b: 2, c: 3 })
  })

  it('a mixed default and namespace import lands both bindings on the scope', async () => {
    const session = createReplSessionInRealm({})
    const dep = `data:text/javascript;charset=utf-8,${encodeURIComponent('export default 1\nexport const named = 2')}`
    const imported = await session.evaluate(`import def, * as ns from '${dep}'`)
    expect(imported.ok).toBe(true)

    const defRead = await session.evaluate('def')
    const nsRead = await session.evaluate('ns.named')
    expect(defRead.value).toBe(1)
    expect(nsRead.value).toBe(2)
  })

  it('calling a top-level function before its textual declaration works within one input', async () => {
    const session = createReplSessionInRealm({})
    // The input's last statement is the declaration, not an expression, so
    // it has no completion value; what matters is that the earlier call
    // does not throw, and that the function is left in a working state.
    const result = await session.evaluate('f()\nfunction f() {\n  return 1\n}')
    expect(result.ok).toBe(true)

    const read = await session.evaluate('f()')
    expect(read.value).toBe(1)
  })

  it('a computed destructuring key declared in an earlier evaluation is resolved and rewritten', async () => {
    const session = createReplSessionInRealm({})
    await session.evaluate("let k = 'x'")
    const result = await session.evaluate('const { [k]: v } = { x: 42 }')
    expect(result.ok).toBe(true)

    const vRead = await session.evaluate('v')
    expect(vRead.value).toBe(42)
  })

  it('assignment destructuring with a default value assigns onto the scope', async () => {
    const session = createReplSessionInRealm({})
    await session.evaluate('let a')
    const result = await session.evaluate('({ a = 1 } = {})')
    expect(result.ok).toBe(true)
    // A destructuring assignment expression evaluates to its right-hand
    // side, not the destructured default.
    expect(result.value).toEqual({})

    const aRead = await session.evaluate('a')
    expect(aRead.value).toBe(1)
  })
})
