import { createReplSessionInRealm } from 'src/bootstrap'
import { parseUserModule } from 'src/parse'
import { ReplTransformError, transformReplInput } from 'src/transform-repl'

const SCOPE_URL = 'data:text/javascript,scope-module'

const transform = (input: string, options?: { deps?: Record<string, string>; autoInstall?: boolean }): string =>
  transformReplInput(input, parseUserModule(input), { scopeModuleUrl: SCOPE_URL, ...options }).code

const wrap = (body: string): string =>
  [
    `import { __esmwell, __esmwellTypeof } from '${SCOPE_URL}'`,
    'export const __esmwellResult = await (async () => {',
    body,
    '})()',
  ].join('\n')

describe('transformReplInput: declarations become scope assignments', () => {
  it.each([
    { name: 'let with initializer', input: 'let count = 0', body: '__esmwell.count = 0' },
    { name: 'let without initializer', input: 'let pending', body: '__esmwell.pending = undefined' },
    { name: 'const function', input: 'const double = (n) => n * 2', body: '__esmwell.double = (n) => n * 2' },
    {
      name: 'function declaration keeps its name',
      input: 'function fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2)\n}',
      body: '__esmwell.fib = function fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2)\n}\n;',
    },
    {
      name: 'class declaration keeps its name and lexical self-reference',
      input: 'class Point {\n  norm() {\n    return new Point()\n  }\n}',
      body: '__esmwell.Point = class Point {\n  norm() {\n    return new Point()\n  }\n}',
    },
    {
      name: 'object destructuring with renaming and defaults',
      input: 'const { a, b: renamed, c = 3 } = source',
      // Leading `;` guards against ASI fusing this with a preceding
      // semicolon-free statement: a rewritten ObjectPattern declarator is
      // parenthesized, so the line would otherwise start with `(`.
      body: ';({ a: __esmwell.a, b: __esmwell.renamed, c: __esmwell.c = 3 } = __esmwell.source)',
    },
    {
      name: 'array destructuring with rest',
      input: 'const [first, , third, ...rest] = items',
      // Same ASI guard: the rewritten line starts with `[`.
      body: ';[__esmwell.first, , __esmwell.third, ...__esmwell.rest] = __esmwell.items',
    },
    {
      name: 'object rest destructuring',
      input: 'const { a, ...rest } = source',
      body: ';({ a: __esmwell.a, ...__esmwell.rest } = __esmwell.source)',
    },
    {
      name: 'multiple declarators',
      input: 'let one = 1, two = 2',
      body: '__esmwell.one = 1, __esmwell.two = 2',
    },
  ])('$name', ({ input, body }) => {
    expect(transform(input)).toBe(wrap(body))
  })
})

describe('transformReplInput: references become live scope reads', () => {
  it.each([
    { name: 'free references read the scope', input: 'count + 1', body: 'return __esmwell.count + 1' },
    { name: 'update expressions persist', input: 'count++', body: 'return __esmwell.count++' },
    {
      name: 'globals fall back through the scope',
      input: "console.log('hi')",
      body: "return __esmwell.console.log('hi')",
    },
    {
      name: 'shorthand properties expand',
      input: 'let width = 10\nconst size = { width, height: width * 2 }',
      body: '__esmwell.width = 10\n__esmwell.size = { width: __esmwell.width, height: __esmwell.width * 2 }',
    },
    {
      name: 'nested scopes keep their own bindings',
      input: 'function f(a) {\n  return a\n}',
      body: '__esmwell.f = function f(a) {\n  return a\n}\n;',
    },
    {
      name: 'loop bindings stay local',
      input: 'for (const item of list) {\n  console.log(item)\n}',
      body: 'for (const item of __esmwell.list) {\n  __esmwell.console.log(item)\n}',
    },
    {
      name: 'blocks keep their lets local',
      input: '{\n  let inner = 1\n  inner\n}',
      body: '{\n  let inner = 1\n  inner\n}',
    },
    {
      name: 'top-level await passes through',
      input: 'await Promise.resolve(42)',
      body: 'return await __esmwell.Promise.resolve(42)',
    },
    {
      name: 'direct typeof reads through the non-throwing scope view',
      input: 'typeof missing',
      body: 'return typeof __esmwellTypeof.missing',
    },
    {
      name: 'direct typeof keeps same-input declarations on the ordinary scope',
      input: 'let present = 1\ntypeof present',
      body: '__esmwell.present = 1\nreturn typeof __esmwell.present',
    },
    {
      name: 'typeof a member still throws when its object is missing',
      input: 'typeof missing.property',
      body: 'return typeof __esmwell.missing.property',
    },
    { name: 'plain completion value', input: '1 + 1', body: 'return 1 + 1' },
    {
      name: 'no completion for declarations',
      input: 'let stored = 5',
      body: '__esmwell.stored = 5',
    },
  ])('$name', ({ input, body }) => {
    expect(transform(input)).toBe(wrap(body))
  })
})

describe('transformReplInput: imports become dynamic assignments', () => {
  it('rewrites default imports', () => {
    expect(transform(`import isEven from 'is-even'`, { deps: { 'is-even': '1.0.0' } })).toBe(
      wrap(
        `{ const __esmwell_mod_0 = await import('https://esm.sh/is-even@1.0.0'); __esmwell.isEven = __esmwell_mod_0.default }`,
      ),
    )
  })

  it('rewrites named imports with access by name', () => {
    expect(transform(`import { shuffle, map as m } from 'lodash-es'`)).toBe(
      wrap(
        `{ const __esmwell_mod_0 = await import('https://esm.sh/lodash-es@latest'); __esmwell.shuffle = __esmwell_mod_0['shuffle']; __esmwell.m = __esmwell_mod_0['map'] }`,
      ),
    )
  })

  it('rewrites namespace imports', () => {
    expect(transform(`import * as ns from 'pkg'`)).toBe(
      wrap(`{ const __esmwell_mod_0 = await import('https://esm.sh/pkg@latest'); __esmwell.ns = __esmwell_mod_0 }`),
    )
  })

  it('rewrites a mixed default and namespace import without dropping the default binding', () => {
    expect(transform(`import def, * as ns from 'pkg'`)).toBe(
      wrap(
        `{ const __esmwell_mod_0 = await import('https://esm.sh/pkg@latest'); __esmwell.def = __esmwell_mod_0.default; __esmwell.ns = __esmwell_mod_0 }`,
      ),
    )
  })

  it('rewrites a string-literal imported binding name', () => {
    expect(transform(`import { "a-b" as ab } from 'pkg'`)).toBe(
      wrap(
        `{ const __esmwell_mod_0 = await import('https://esm.sh/pkg@latest'); __esmwell.ab = __esmwell_mod_0['a-b'] }`,
      ),
    )
  })

  it('rewrites bare side-effect imports', () => {
    expect(transform(`import 'pkg'`)).toBe(wrap(`await import('https://esm.sh/pkg@latest');`))
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
        `{ const __esmwell_mod_0 = await import('https://esm.sh/pkg@latest'); __esmwell.shuffle = __esmwell_mod_0['shuffle'] }\nreturn __esmwell.shuffle([1, 2])`,
      ),
    )
  })
})

describe('transformReplInput: ESM declarations seed the persistent scope', () => {
  it('persists a named exported declaration', () => {
    expect(transform('export const solve = (input) => input.value * 2')).toBe(
      wrap('__esmwell.solve = (input) => input.value * 2'),
    )
  })

  it('persists named default function and class declarations', () => {
    expect(transform('export default function run() { return 1 }')).toBe(
      wrap('__esmwell.run = function run() { return 1 }\n;'),
    )
    expect(transform('export default class Box {}')).toBe(wrap('__esmwell.Box = class Box {}'))
  })

  it('erases a local export list after its declarations have persisted', () => {
    expect(transform('const solve = () => 1\nexport { solve }')).toBe(wrap('__esmwell.solve = () => 1\n;'))
  })
})

describe('transformReplInput: rejections', () => {
  it.each([
    ['export default 1', /default export needs a named function or class/],
    [`export * from 'pkg'`, /cannot use export \*/],
    [`export { value } from 'pkg'`, /cannot re-export/],
  ])('rejects %j', (input, message) => {
    expect(() => transform(input)).toThrow(ReplTransformError)
    expect(() => transform(input)).toThrow(message)
  })
})

describe('transformReplInput: ASI safety in semicolon-free multi-statement input', () => {
  it('does not fuse an array-pattern declaration into the previous statement', () => {
    // Without a leading `;`, `1\n[__esmwell.a] = [2]` parses as `1[__esmwell.a]
    // = [2]` — a computed member assignment on the number literal, not two
    // statements.
    expect(transform('let f = () => 1\nlet [a] = [2]')).toBe(wrap('__esmwell.f = () => 1\n;[__esmwell.a] = [2]'))
  })

  it('does not fuse an object-pattern declaration into the previous statement', () => {
    expect(transform('let g = () => 1\nlet { a } = { a: 2 }')).toBe(
      wrap('__esmwell.g = () => 1\n;({ a: __esmwell.a } = { a: 2 })'),
    )
  })

  it('does not fuse the statements around a hoisted function declaration', () => {
    expect(transform('foo()\nfunction helper() {}\n[1, 2].map((n) => n)')).toBe(
      wrap('__esmwell.helper = function helper() {}\n__esmwell.foo()\n;\nreturn [1, 2].map((n) => n)'),
    )
  })

  it('terminates a side-effect import so the next line cannot fuse with it', () => {
    expect(transform("import 'data:text/javascript,'\n[1, 2].length")).toBe(
      wrap("await import('data:text/javascript,');\nreturn [1, 2].length"),
    )
  })
})

describe('transformReplInput: function declarations hoist', () => {
  it('emits a single top-level function ahead of a call that precedes it', () => {
    expect(transform('f()\nfunction f() {\n  return 1\n}')).toBe(
      wrap('__esmwell.f = function f() {\n  return 1\n}\n__esmwell.f()\n;'),
    )
  })

  it('lets mutually calling top-level functions reference each other regardless of order', () => {
    expect(transform('a()\nb()\nfunction a() {\n  return b()\n}\nfunction b() {\n  return 1\n}')).toBe(
      wrap(
        '__esmwell.a = function a() {\n  return __esmwell.b()\n}\n__esmwell.b = function b() {\n  return 1\n}\n__esmwell.a()\n__esmwell.b()\n;\n;',
      ),
    )
  })

  it('keeps class declarations in place (no hoisting) since class bindings are in the temporal dead zone', () => {
    expect(transform('class Point {\n  norm() {\n    return new Point()\n  }\n}')).toBe(
      wrap('__esmwell.Point = class Point {\n  norm() {\n    return new Point()\n  }\n}'),
    )
  })
})

describe('transformReplInput: assignment-position and computed-key patterns', () => {
  it('rewrites a cover-initialized shorthand property in assignment destructuring', () => {
    expect(transform('({ a = 1 } = obj)')).toBe(wrap('return ({ a: __esmwell.a = 1 } = __esmwell.obj)'))
  })

  it('rewrites the key expression of a computed destructuring property', () => {
    expect(transform('const { [k]: v } = o')).toBe(wrap(';({ [__esmwell.k]: __esmwell.v } = __esmwell.o)'))
  })
})

describe('REPL execution: rewrites hold under real evaluation, not just generated text', () => {
  it('keeps statements separated around a hoisted function declaration', async () => {
    const session = createReplSessionInRealm({})
    const result = await session.evaluate('const foo = () => 1\nfoo()\nfunction helper() {}\n[1, 2].map((n) => n)')
    expect(result.ok).toBe(true)
    expect(result.value).toEqual([1, 2])
  })

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
