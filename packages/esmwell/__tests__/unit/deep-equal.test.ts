import { deepEqual } from 'src/deep-equal'

interface EqualityCase {
  name: string
  actual: unknown
  expected: unknown
  equal: boolean
}

const cyclicSelfReference = (): { self: unknown } => {
  const value: { self: unknown } = { self: null }
  value.self = value
  return value
}

const sparseArray = (): unknown[] => {
  const array: unknown[] = []
  array.length = 2
  array[1] = 2
  return array
}

class PointFixture {
  x = 1
}

const equalityCases: EqualityCase[] = [
  // Primitives
  { name: 'equal numbers', actual: 42, expected: 42, equal: true },
  { name: 'equal strings', actual: 'esmwell', expected: 'esmwell', equal: true },
  { name: 'equal booleans', actual: false, expected: false, equal: true },
  { name: 'equal null', actual: null, expected: null, equal: true },
  { name: 'equal undefined', actual: undefined, expected: undefined, equal: true },
  { name: 'equal bigints', actual: 7n, expected: 7n, equal: true },
  { name: 'number vs string', actual: 1, expected: '1', equal: false },
  { name: 'null vs undefined', actual: null, expected: undefined, equal: false },
  { name: 'false vs 0', actual: false, expected: 0, equal: false },
  { name: 'distinct symbols', actual: Symbol('a'), expected: Symbol('a'), equal: false },
  { name: 'same symbol', actual: Symbol.for('shared'), expected: Symbol.for('shared'), equal: true },

  // Object.is edge cases
  { name: 'NaN equals NaN', actual: Number.NaN, expected: Number.NaN, equal: true },
  { name: 'plus zero vs minus zero', actual: 0, expected: -0, equal: false },
  { name: 'minus zero vs minus zero', actual: -0, expected: -0, equal: true },

  // Functions by reference
  { name: 'same function', actual: deepEqual, expected: deepEqual, equal: true },
  {
    name: 'distinct functions',
    actual: (): void => {},
    expected: (): void => {},
    equal: false,
  },

  // Dates
  {
    name: 'same instant',
    actual: new Date('2024-01-01T00:00:00Z'),
    expected: new Date('2024-01-01T00:00:00Z'),
    equal: true,
  },
  { name: 'different instants', actual: new Date(0), expected: new Date(1), equal: false },
  { name: 'both invalid dates', actual: new Date('nope'), expected: new Date('nah'), equal: true },
  { name: 'date vs number', actual: new Date(0), expected: 0, equal: false },

  // RegExp: source and flags
  { name: 'same regexp', actual: /a+/gi, expected: /a+/gi, equal: true },
  { name: 'regexp differing in source', actual: /a/g, expected: /b/g, equal: false },
  { name: 'regexp differing in flags', actual: /a/g, expected: /a/i, equal: false },
  { name: 'regexp vs plain object', actual: /a/, expected: { lastIndex: 0 }, equal: false },

  // Boxed primitives: wrapped value
  { name: 'same boxed number', actual: new Number(1), expected: new Number(1), equal: true },
  { name: 'different boxed numbers', actual: new Number(1), expected: new Number(2), equal: false },
  {
    name: 'boxed NaN equals boxed NaN',
    actual: new Number(Number.NaN),
    expected: new Number(Number.NaN),
    equal: true,
  },
  { name: 'same boxed string', actual: new String('x'), expected: new String('x'), equal: true },
  { name: 'same boxed bigint', actual: Object(1n), expected: Object(1n), equal: true },
  { name: 'different boxed bigints', actual: Object(1n), expected: Object(2n), equal: false },
  {
    name: 'same boxed global symbol',
    actual: Object(Symbol.for('shared-boxed')),
    expected: Object(Symbol.for('shared-boxed')),
    equal: true,
  },
  { name: 'distinct boxed symbols', actual: Object(Symbol('x')), expected: Object(Symbol('x')), equal: false },
  { name: 'boxed vs primitive', actual: new Number(1), expected: 1, equal: false },
  { name: 'boxed number vs boxed string', actual: new Number(1), expected: new String('1'), equal: false },

  // Errors: name, message, cause; stack ignored
  { name: 'same error', actual: new Error('boom'), expected: new Error('boom'), equal: true },
  { name: 'error differing in message', actual: new Error('a'), expected: new Error('b'), equal: false },
  { name: 'error differing in class', actual: new TypeError('x'), expected: new RangeError('x'), equal: false },
  {
    name: 'error with equal cause',
    actual: new Error('x', { cause: { code: 1 } }),
    expected: new Error('x', { cause: { code: 1 } }),
    equal: true,
  },
  {
    name: 'error with different cause',
    actual: new Error('x', { cause: 1 }),
    expected: new Error('x', { cause: 2 }),
    equal: false,
  },
  { name: 'error vs plain object', actual: new Error('x'), expected: { message: 'x' }, equal: false },

  // Arrays
  { name: 'same arrays', actual: [1, 2, 3], expected: [1, 2, 3], equal: true },
  { name: 'nested arrays', actual: [1, [2, [3, [4]]]], expected: [1, [2, [3, [4]]]], equal: true },
  { name: 'different element', actual: [1, 2, 3], expected: [1, 2, 4], equal: false },
  { name: 'different length', actual: [1, 2], expected: [1, 2, 3], equal: false },
  { name: 'array vs object', actual: [1], expected: { 0: 1 }, equal: false },
  { name: 'sparse holes preserved', actual: sparseArray(), expected: sparseArray(), equal: true },
  { name: 'hole vs value', actual: sparseArray(), expected: [1, 2], equal: false },
  { name: 'array vs null-prototype object', actual: [], expected: Object.create(null), equal: false },

  // Plain objects
  { name: 'same properties', actual: { a: 1, b: 'two' }, expected: { a: 1, b: 'two' }, equal: true },
  {
    name: 'nested objects',
    actual: { a: { b: { c: [1, { d: 2 }] } } },
    expected: { a: { b: { c: [1, { d: 2 }] } } },
    equal: true,
  },
  { name: 'extra key', actual: { a: 1 }, expected: { a: 1, b: 2 }, equal: false },
  { name: 'different value', actual: { a: 1 }, expected: { a: 2 }, equal: false },
  {
    name: 'object vs null prototype',
    actual: { a: 1 },
    expected: Object.assign(Object.create(null), { a: 1 }),
    equal: false,
  },
  { name: 'instance vs literal', actual: new PointFixture(), expected: { x: 1 }, equal: false },
  {
    name: 'same class instances',
    actual: new PointFixture(),
    expected: new PointFixture(),
    equal: true,
  },
  {
    name: 'symbol keys compared',
    actual: { [Symbol('k')]: 1 } as unknown,
    expected: { [Symbol('k')]: 2 } as unknown,
    equal: false,
  },

  // Maps
  {
    name: 'same map entries',
    actual: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    expected: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    equal: true,
  },
  {
    name: 'insertion-order-insensitive maps',
    actual: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    expected: new Map([
      ['b', 2],
      ['a', 1],
    ]),
    equal: true,
  },
  {
    name: 'deep map keys and values',
    actual: new Map([[{ x: 1 }, [1, 2]]]),
    expected: new Map([[{ x: 1 }, [1, 2]]]),
    equal: true,
  },
  {
    name: 'map key mismatch',
    actual: new Map([[{ x: 1 }, 'v']]),
    expected: new Map([[{ x: 2 }, 'v']]),
    equal: false,
  },
  {
    name: 'map value mismatch',
    actual: new Map([['k', 1]]),
    expected: new Map([['k', 2]]),
    equal: false,
  },
  {
    name: 'map size mismatch',
    actual: new Map([['a', 1]]),
    expected: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    equal: false,
  },
  { name: 'map vs object', actual: new Map(), expected: {}, equal: false },
  {
    // Keys are structurally equal across entries, but values are not for any
    // valid pairing — a key-only matcher would wrongly accept this.
    name: 'map entries with matching keys but mismatched values — false accept guard',
    actual: new Map([
      [{ id: 1 }, 'a'],
      [{ id: 1 }, 'b'],
    ]),
    expected: new Map([
      [{ id: 1 }, 'a'],
      [{ id: 1 }, 'c'],
    ]),
    equal: false,
  },
  {
    // A valid bijection exists even though both entries share the same
    // structural key; the matcher must find it instead of over-consuming.
    name: 'map entries with a shared duplicate key shape — false reject guard',
    actual: new Map([
      [{ id: 1 }, 'a'],
      [{ id: 1 }, 'b'],
    ]),
    expected: new Map([
      [{ id: 1 }, 'b'],
      [{ id: 1 }, 'a'],
    ]),
    equal: true,
  },

  // Sets
  { name: 'same sets', actual: new Set([1, 2, 3]), expected: new Set([1, 2, 3]), equal: true },
  {
    name: 'insertion-order-insensitive sets',
    actual: new Set([1, 2, 3]),
    expected: new Set([3, 2, 1]),
    equal: true,
  },
  {
    name: 'deep set members',
    actual: new Set([[1], { a: new Date(0) }]),
    expected: new Set([{ a: new Date(0) }, [1]]),
    equal: true,
  },
  { name: 'set member mismatch', actual: new Set([1]), expected: new Set([2]), equal: false },
  { name: 'set size mismatch', actual: new Set([1]), expected: new Set([1, 2]), equal: false },
  { name: 'set vs array', actual: new Set([1]), expected: [1], equal: false },
  {
    // A greedy, non-consuming matcher would let both actual members
    // independently "find" expected's {a:1}, wrongly accepting this.
    name: 'set members structurally equal but distinct — false accept guard',
    actual: new Set([{ a: 1 }, { a: 1 }]),
    expected: new Set([{ a: 1 }, { a: 2 }]),
    equal: false,
  },
  {
    // A greedy matcher can consume the one expected {a:1} for the first
    // actual {a:1}, leaving the second actual {a:1} with no candidate even
    // though a valid bijection exists (each expected member used once).
    name: 'equal-size sets with a shared duplicate shape — false reject guard',
    actual: new Set([{ a: 1 }, { a: 1 }]),
    expected: new Set([{ a: 1 }, { a: 1 }]),
    equal: true,
  },

  // TypedArrays
  { name: 'equal uint8', actual: new Uint8Array([1, 2, 3]), expected: new Uint8Array([1, 2, 3]), equal: true },
  { name: 'different uint8', actual: new Uint8Array([1, 2, 3]), expected: new Uint8Array([1, 2, 4]), equal: false },
  { name: 'different lengths', actual: new Uint8Array([1]), expected: new Uint8Array([1, 1]), equal: false },
  { name: 'constructor mismatch', actual: new Uint8Array([1, 2]), expected: new Int8Array([1, 2]), equal: false },
  { name: 'clamped mismatch', actual: new Uint8ClampedArray([255]), expected: new Uint8Array([255]), equal: false },
  {
    name: 'equal int32',
    actual: new Int32Array([-1, 0x7fffffff]),
    expected: new Int32Array([-1, 0x7fffffff]),
    equal: true,
  },
  { name: 'equal bigint64', actual: new BigInt64Array([1n, -2n]), expected: new BigInt64Array([1n, -2n]), equal: true },
  {
    name: 'float NaN bytes',
    actual: new Float64Array([Number.NaN]),
    expected: new Float64Array([Number.NaN]),
    equal: true,
  },
  { name: 'float zero signs', actual: new Float64Array([0]), expected: new Float64Array([-0]), equal: false },
  {
    name: 'offset views compare bytes',
    actual: new Uint8Array([9, 9, 1, 2]).subarray(2),
    expected: new Uint8Array([1, 2]),
    equal: true,
  },
  { name: 'typed array vs array', actual: new Uint8Array([1]), expected: [1], equal: false },

  // Nested combinations
  {
    name: 'deep mixed structure',
    actual: { list: [new Map([['k', new Set([1, new Date(0)])]])] },
    expected: { list: [new Map([['k', new Set([1, new Date(0)])]])] },
    equal: true,
  },
  {
    name: 'deep mixed structure with mutation',
    actual: { list: [new Map([['k', new Set([1, new Date(0)])]])] },
    expected: { list: [new Map([['k', new Set([1, new Date(1)])]])] },
    equal: false,
  },

  // Cycles
  { name: 'self-referential structures', actual: cyclicSelfReference(), expected: cyclicSelfReference(), equal: true },
  {
    name: 'cycle vs plain nesting',
    actual: cyclicSelfReference(),
    expected: { self: { self: null } },
    equal: false,
  },
  {
    name: 'mutually cyclic arrays',
    actual: (() => {
      const a: unknown[] = []
      a.push(a)
      return a
    })(),
    expected: (() => {
      const b: unknown[] = []
      b.push(b)
      return b
    })(),
    equal: true,
  },
]

describe('deepEqual', () => {
  it.each(equalityCases)('$name → $equal', ({ actual, expected, equal }) => {
    expect(deepEqual(actual, expected)).toBe(equal)
  })

  it('is symmetric for the fixture set', () => {
    for (const { actual, expected, equal } of equalityCases) {
      expect(deepEqual(expected, actual)).toBe(equal)
    }
  })
})
