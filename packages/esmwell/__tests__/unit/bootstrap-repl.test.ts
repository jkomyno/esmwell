import { createReplSessionInRealm } from 'src/bootstrap'
import type { ReplRealmSession } from 'src/bootstrap'
import type { ReplResult } from 'src/types'

const evaluate = async (session: ReplRealmSession, input: string): Promise<ReplResult> => session.evaluate(input)

describe('REPL persistence', () => {
  it('count++ increments exactly once across inputs', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'let count = 0')
    await evaluate(session, 'count++')
    const read = await evaluate(session, 'count')
    expect(read.value).toBe(1)
  })

  it('closures observe reassignments', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'let x = 1')
    await evaluate(session, 'const get = () => x')
    await evaluate(session, 'x = 5')
    const read = await evaluate(session, 'get()')
    expect(read.value).toBe(5)
  })

  it('imports persist across inputs', async () => {
    const session = createReplSessionInRealm({})
    const dep = `data:text/javascript;charset=utf-8,${encodeURIComponent('export const double = (x) => x * 2')}`
    const imported = await evaluate(session, `import { double } from '${dep}'`)
    expect(imported.ok).toBe(true)

    const used = await evaluate(session, 'double(21)')
    expect(used.value).toBe(42)
  })

  it('let redeclaration reassigns instead of erroring', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'let version = 1')
    const redeclared = await evaluate(session, 'let version = 2')
    expect(redeclared.ok).toBe(true)
    const read = await evaluate(session, 'version')
    expect(read.value).toBe(2)
  })

  it('treats __proto__ as an ordinary persistent binding', async () => {
    const session = createReplSessionInRealm({})
    const declared = await evaluate(session, 'let __proto__ = { marker: 42 }')
    const read = await evaluate(session, '__proto__.marker')
    const owned = await evaluate(session, "Object.hasOwn(__esmwell, '__proto__')")

    expect(declared.ok).toBe(true)
    expect(read).toMatchObject({ ok: true, value: 42 })
    expect(owned).toMatchObject({ ok: true, value: true })
  })

  it('keeps bindings when submitted code replaces Object.hasOwn', async () => {
    const session = createReplSessionInRealm({})
    const nativeHasOwn = Object.hasOwn
    let read: ReplResult
    try {
      await evaluate(session, 'Object.hasOwn = () => false')
      await evaluate(session, 'let kept = 42')
      read = await evaluate(session, 'kept')
    } finally {
      Object.hasOwn = nativeHasOwn
    }

    expect(read).toMatchObject({ ok: true, value: 42 })
  })

  it('function and class declarations persist with live self-references', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'function fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2)\n}')
    await evaluate(session, 'class Box {\n  static empty() {\n    return new Box()\n  }\n}')
    const fibbed = await evaluate(session, 'fib(10)')
    const boxed = await evaluate(session, 'Box.empty() instanceof Box')
    expect(fibbed.value).toBe(55)
    expect(boxed.value).toBe(true)
  })

  it('a class static initializer can reference the class itself', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'class Counter {\n  static instance = new Counter()\n}')
    const read = await evaluate(session, 'Counter.instance instanceof Counter')
    expect(read.value).toBe(true)
  })

  it('destructuring declarations persist member by member', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'const { a, b: renamed, c = 7 } = { a: 1, b: 2 }')
    const read = await evaluate(session, '[a, renamed, c]')
    expect(read.value).toEqual([1, 2, 7])
  })

  it('shadowed parameters do not leak to the session scope', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'let a = 1')
    await evaluate(session, 'function f(a) {\n  return a\n}')
    const call = await evaluate(session, 'f(7)')
    const read = await evaluate(session, 'a')
    expect(call.value).toBe(7)
    expect(read.value).toBe(1)
  })

  it('inner bindings never persist', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, '{\n  let inner = 1\n}')
    const read = await evaluate(session, 'inner')
    expect(read.error).toMatchObject({ name: 'ReferenceError', message: 'inner is not defined' })
  })

  it('top-level await works', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'await Promise.resolve(42)')
    expect(result.value).toBe(42)
  })

  it('completion value is the final expression', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'let stored = 5\nstored + 1')
    expect(result.value).toBe(6)
  })

  it('declarations alone produce no completion value', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'let stored = 5')
    expect(result.ok).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('errors do not kill the session', async () => {
    const session = createReplSessionInRealm({})
    const failed = await evaluate(session, 'missingFunction()')
    expect(failed.ok).toBe(false)
    expect(failed.error).toMatchObject({ name: 'ReferenceError', message: 'missingFunction is not defined' })

    const recovered = await evaluate(session, 'let recovered = true')
    const read = await evaluate(session, 'recovered')
    expect(recovered.ok).toBe(true)
    expect(read.value).toBe(true)
  })

  it('reset() starts a fresh scope', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'let kept = 1')
    session.reset()
    const read = await evaluate(session, 'kept')
    expect(read.error).toMatchObject({ name: 'ReferenceError', message: 'kept is not defined' })
  })

  it('typeof an unknown name remains undefined', async () => {
    const session = createReplSessionInRealm({})
    const missing = await evaluate(session, 'typeof neverDeclared')
    await evaluate(session, 'let storedValue = 1')
    const stored = await evaluate(session, 'typeof storedValue')
    expect(missing).toMatchObject({ ok: true, value: 'undefined' })
    expect(stored).toMatchObject({ ok: true, value: 'number' })
  })

  it('re-evaluating identical input runs again', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'let hits = 0')
    await evaluate(session, 'hits++')
    await evaluate(session, 'hits++')
    const read = await evaluate(session, 'hits')
    expect(read.value).toBe(2)
  })
})

describe('REPL rejections and capture', () => {
  it('loads named ESM declarations into the persistent scope', async () => {
    const session = createReplSessionInRealm({})
    const loaded = await evaluate(session, 'const factor = 2\nexport const solve = (input) => input.value * factor')
    const result = await evaluate(session, 'solve({ value: 21 })')
    expect(loaded.ok).toBe(true)
    expect(result.value).toBe(42)
  })

  it('reports syntax errors with positions', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'const a = {')
    expect(result.ok).toBe(false)
    expect(result.error).toMatchObject({ name: 'UserSyntaxError' })
    expect(result.error?.message).toMatch(/line 1/)
  })

  it('enforces the policy gate', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'var leaked = 1')
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('var declarations are not allowed')
  })

  it('reports resolution failures for undeclared packages under autoInstall off', async () => {
    const session = createReplSessionInRealm({ autoInstall: false })
    const result = await evaluate(session, "import leftPad from 'left-pad'")
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain("could not resolve 'left-pad'")
  })

  it('captures console output per evaluation', async () => {
    const session = createReplSessionInRealm({})
    const streamed: string[] = []
    const first = await session.evaluate("console.log('first')", {
      onConsoleChunk: (chunk) => {
        streamed.push(chunk.parts.join(' '))
      },
    })
    const second = await session.evaluate("console.warn('second')")

    expect(first.console).toEqual([{ level: 'log', parts: ['first'] }])
    expect(second.console).toEqual([{ level: 'warn', parts: ['second'] }])
    expect(streamed).toEqual(['first'])
  })

  it('globals fall back through the scope object', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'Math.max(1, 5)')
    expect(result.value).toBe(5)
  })

  it('a global function reached through the scope is bound to the realm global', async () => {
    const session = createReplSessionInRealm({})
    const probe = globalThis as Record<string, unknown>
    probe.replThisProbe = {
      replThisProbe(this: unknown): boolean {
        return this === globalThis
      },
    }.replThisProbe
    try {
      const result = await evaluate(session, 'replThisProbe()')
      expect(result.value).toBe(true)
    } finally {
      delete probe.replThisProbe
    }
  })

  it('a bound global function has stable identity across accesses', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, '__esmwell.setTimeout === __esmwell.setTimeout')
    expect(result.value).toBe(true)
  })

  it('global constructors keep their identity', async () => {
    const session = createReplSessionInRealm({})
    expect((await evaluate(session, '[].constructor === Array')).value).toBe(true)
    expect((await evaluate(session, 'new Map().constructor === Map')).value).toBe(true)
    expect((await evaluate(session, 'Promise.resolve(1) instanceof Promise')).value).toBe(true)
    expect((await evaluate(session, 'class Sub extends Map {}\nnew Sub() instanceof Map')).value).toBe(true)
  })

  it('a user-declared value on the scope passes through unmodified', async () => {
    const session = createReplSessionInRealm({})
    await evaluate(session, 'function greet() {}')
    const name = await evaluate(session, 'greet.name')
    // Binding renames a function to "bound <name>"; an unwrapped
    // declaration keeps its original name.
    expect(name.value).toBe('greet')
  })

  it('a non-function global passes through without binding', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'Math')
    expect(result.value).toBe(Math)
  })

  it('bound globals stay constructible', async () => {
    const session = createReplSessionInRealm({})
    const result = await evaluate(session, 'new __esmwell.Map([[1, 2]]).get(1)')
    expect(result.value).toBe(2)
  })
})
