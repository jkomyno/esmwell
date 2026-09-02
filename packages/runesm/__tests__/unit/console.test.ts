import { installConsoleCapture, serializeValue } from 'src/console'
import type { ConsoleChunk } from 'src/types'

function namedFixture(): void {}

const asyncNamedFixture = async (): Promise<void> => {}

describe('serializeValue', () => {
  it.each([
    { name: 'string at top level', value: 'hello', expected: 'hello' },
    { name: 'quoted string in array', value: ['hello'], expected: "['hello']" },
    { name: 'number', value: 42, expected: '42' },
    { name: 'negative zero', value: -0, expected: '-0' },
    { name: 'NaN', value: Number.NaN, expected: 'NaN' },
    { name: 'bigint', value: 3n, expected: '3n' },
    { name: 'boolean', value: true, expected: 'true' },
    { name: 'null and undefined', value: [null, undefined], expected: '[null, undefined]' },
    { name: 'symbol', value: Symbol('tag'), expected: 'Symbol(tag)' },
    { name: 'date', value: new Date(0), expected: '1970-01-01T00:00:00.000Z' },
    { name: 'invalid date', value: new Date('nope'), expected: 'Invalid Date' },
    { name: 'regexp', value: /ab+c/gi, expected: '/ab+c/gi' },
    { name: 'error', value: new RangeError('out of bounds'), expected: 'RangeError: out of bounds' },
    { name: 'array of values', value: [1, 'two', [3]], expected: "[1, 'two', [3]]" },
    { name: 'object', value: { a: 1, b: 'x' }, expected: "{ a: 1, b: 'x' }" },
    { name: 'quoted non-identifier keys', value: { 'not-id': 1 }, expected: "{ 'not-id': 1 }" },
    {
      name: 'map',
      value: new Map<string | number, string | number>([
        ['a', 1],
        [2, 'b'],
      ]),
      expected: "Map(2) { 'a' => 1, 2 => 'b' }",
    },
    { name: 'set', value: new Set([1, 'a']), expected: "Set(2) { 1, 'a' }" },
    { name: 'typed array', value: new Uint8Array([1, 2, 3]), expected: 'Uint8Array(3) [1, 2, 3]' },
    { name: 'promise', value: Promise.resolve(1), expected: 'Promise { … }' },
  ])('$name', ({ value, expected }) => {
    expect(serializeValue(value)).toBe(expected)
  })

  it('serializes named and anonymous functions honestly', () => {
    expect(serializeValue(namedFixture)).toBe('[function namedFixture]')
    expect(serializeValue((): void => {})).toBe('[function (anonymous)]')
    expect(serializeValue(asyncNamedFixture)).toBe('[async function asyncNamedFixture]')
  })

  it('caps depth on nested structures', () => {
    const deep = { a: { b: { c: { d: 1 } } } }
    expect(serializeValue(deep)).toBe('{ a: { b: { c: [Object] } } }')
    expect(serializeValue([[['inner']]])).toBe("[[['inner']]]")
    expect(serializeValue([[[['too-deep']]]])).toBe('[[[[Array]]]]')
  })

  it('marks circular references', () => {
    const value: { self?: unknown } = {}
    value.self = value
    expect(serializeValue(value)).toBe('{ self: [Circular] }')
  })

  it('bounds strings and collection previews', () => {
    const longString = 'x'.repeat(20_000)
    const wideArray = Array.from({ length: 120 }, (_, index) => index)

    expect(serializeValue(longString).length).toBeLessThan(20_000)
    expect(serializeValue(longString)).toMatch(/…$/)
    expect(serializeValue(wideArray)).toContain('… 20 more')
    expect(serializeValue(wideArray)).not.toContain('119')
  })

  it('returns a stable preview when object inspection throws', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('blocked')
        },
      },
    )

    expect(serializeValue(hostile)).toBe('[Unserializable]')
  })

  it('bounds wide object previews', () => {
    const wideObject = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`key${index}`, index]))

    expect(serializeValue(wideObject)).toContain('key99: 99, … 20 more')
    expect(serializeValue(wideObject)).not.toContain('key100')
  })

  it('bounds work across nested previews', () => {
    let inspections = 0
    const nested = Array.from({ length: 100 }, () =>
      Array.from({ length: 100 }, () => ({
        get value() {
          inspections += 1
          return 1
        },
      })),
    )

    expect(serializeValue(nested)).toContain('…')
    expect(inspections).toBeLessThan(1_000)
  })
})

describe('installConsoleCapture', () => {
  it('captures levels and parts in order, then restores', () => {
    const chunks: ConsoleChunk[] = []
    const restore = installConsoleCapture({
      write: (chunk) => {
        chunks.push(chunk)
      },
    })

    console.log('first', 1)
    console.warn('second')
    console.error(new Error('broken'))

    restore()

    expect(chunks).toEqual([
      { level: 'log', parts: ['first', '1'] },
      { level: 'warn', parts: ['second'] },
      { level: 'error', parts: ['Error: broken'] },
    ])
  })

  it('does not leak into a fresh capture after restore', () => {
    const firstChunks: ConsoleChunk[] = []
    const firstRestore = installConsoleCapture({
      write: (chunk) => {
        firstChunks.push(chunk)
      },
    })
    console.log('during first')
    firstRestore()

    const secondChunks: ConsoleChunk[] = []
    const secondRestore = installConsoleCapture({
      write: (chunk) => {
        secondChunks.push(chunk)
      },
    })
    console.info('during second')
    secondRestore()

    expect(firstChunks).toEqual([{ level: 'log', parts: ['during first'] }])
    expect(secondChunks).toEqual([{ level: 'info', parts: ['during second'] }])
  })

  it('emits one warning and stops output after the capture budget', () => {
    const chunks: ConsoleChunk[] = []
    const restore = installConsoleCapture({
      write: (chunk) => {
        chunks.push(chunk)
      },
    })

    for (let index = 0; index < 100; index += 1) {
      console.log('x'.repeat(1024))
    }
    restore()

    const logs = chunks.filter((chunk) => chunk.level === 'log')
    // 62 whole chunks fit; the 63rd is clipped to what remains of the budget.
    expect(logs).toHaveLength(63)
    expect(logs.at(-1)?.parts[0]?.length).toBeLessThan(1024)
    expect(chunks.at(-1)).toEqual({
      level: 'warn',
      parts: ['[Console output truncated after 65536 characters]'],
    })
    expect(chunks.filter((chunk) => chunk.level === 'warn')).toHaveLength(1)
  })

  it('clips a single call larger than the whole budget instead of dropping it', () => {
    const chunks: ConsoleChunk[] = []
    const restore = installConsoleCapture({
      write: (chunk) => {
        chunks.push(chunk)
      },
    })

    console.log(...Array.from({ length: 20 }, () => 'y'.repeat(8 * 1024)))
    restore()

    // The call alone exceeds the run budget. It must still produce output.
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.level).toBe('log')
    expect(chunks[0]?.parts[0]).toBe('y'.repeat(8 * 1024))
    expect(chunks[0]?.parts.join('').length).toBeLessThanOrEqual(64 * 1024)
    expect(chunks[1]).toEqual({
      level: 'warn',
      parts: ['[Console output truncated after 65536 characters]'],
    })
  })

  it('caps arguments in one call and skips inspection after truncation', () => {
    const chunks: ConsoleChunk[] = []
    const restore = installConsoleCapture({
      write: (chunk) => {
        chunks.push(chunk)
      },
    })
    let inspections = 0
    const inspected = new Proxy(
      {},
      {
        getPrototypeOf(target) {
          inspections += 1
          return Reflect.getPrototypeOf(target)
        },
      },
    )

    console.log(...Array.from({ length: 120 }, (_, index) => index))
    for (let index = 0; index < 100; index += 1) console.log('x'.repeat(1024))
    console.log(inspected)
    restore()

    expect(chunks[0]?.parts.at(-1)).toBe('… 20 more arguments')
    expect(inspections).toBe(0)
  })
})
