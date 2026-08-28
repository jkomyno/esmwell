/**
 * Structural equality for judged values: primitives (with `Object.is`
 * semantics, so `NaN` equals `NaN` but `+0` does not equal `-0`), arrays,
 * plain objects (same prototype required), `Map`, `Set`, `Date`, `RegExp`
 * (source and flags), boxed primitives (wrapped value), `Error` (name,
 * message, and cause; stack ignored), and every TypedArray class compared
 * byte-wise. Functions compare by reference. Cyclic structures are handled
 * by tracking in-progress comparison pairs.
 */
export function deepEqual(actual: unknown, expected: unknown): boolean {
  return deepEqualGuarded(actual, expected, new ComparisonPairs())
}

const deepEqualGuarded = (actual: unknown, expected: unknown, pairs: ComparisonPairs): boolean => {
  if (Object.is(actual, expected)) {
    return true
  }
  if (typeof actual !== 'object' || actual === null || typeof expected !== 'object' || expected === null) {
    // Functions, distinct primitives, and null/undefined mismatches.
    return false
  }

  if (pairs.isComparing(actual, expected)) {
    // A cycle: this exact pair is already being compared further up the path.
    return true
  }
  pairs.begin(actual, expected)
  try {
    if (actual instanceof Date || expected instanceof Date) {
      return expected instanceof Date && actual instanceof Date && Object.is(actual.getTime(), expected.getTime())
    }

    if (actual instanceof RegExp || expected instanceof RegExp) {
      return (
        actual instanceof RegExp &&
        expected instanceof RegExp &&
        actual.source === expected.source &&
        actual.flags === expected.flags
      )
    }

    const actualBoxed = boxedPrimitiveValue(actual)
    const expectedBoxed = boxedPrimitiveValue(expected)
    if (actualBoxed !== undefined || expectedBoxed !== undefined) {
      return (
        actualBoxed !== undefined &&
        expectedBoxed !== undefined &&
        Object.getPrototypeOf(actual) === Object.getPrototypeOf(expected) &&
        Object.is(actualBoxed, expectedBoxed)
      )
    }

    if (actual instanceof Error || expected instanceof Error) {
      return errorsEqual(actual, expected, pairs)
    }

    if (isTypedArray(actual) || isTypedArray(expected)) {
      return typedArraysEqual(actual, expected)
    }

    if (actual instanceof Map || expected instanceof Map) {
      return mapsEqual(actual, expected, pairs)
    }

    if (actual instanceof Set || expected instanceof Set) {
      return setsEqual(actual, expected, pairs)
    }

    if (Array.isArray(actual) || Array.isArray(expected)) {
      return arraysEqual(actual, expected, pairs)
    }

    return objectsEqual(actual, expected, pairs)
  } finally {
    pairs.end(actual, expected)
  }
}

type PrimitiveValue = boolean | bigint | number | string | symbol

/** Native `valueOf` methods act as brand checks for each primitive wrapper's internal slot. */
const boxedPrimitiveValue = (value: object): PrimitiveValue | undefined => {
  const tag = Object.prototype.toString.call(value)
  switch (tag) {
    case '[object Number]':
      return readBoxedValue(() => Number.prototype.valueOf.call(value))
    case '[object String]':
      return readBoxedValue(() => String.prototype.valueOf.call(value))
    case '[object Boolean]':
      return readBoxedValue(() => Boolean.prototype.valueOf.call(value))
    case '[object BigInt]':
      return readBoxedValue(() => BigInt.prototype.valueOf.call(value))
    case '[object Symbol]':
      return readBoxedValue(() => Symbol.prototype.valueOf.call(value))
    default:
      return undefined
  }
}

const readBoxedValue = (readValue: () => PrimitiveValue): PrimitiveValue | undefined => {
  try {
    return readValue()
  } catch {
    // A custom Symbol.toStringTag can imitate a wrapper, but cannot supply its internal slot.
    return undefined
  }
}

/** Errors compare by prototype, name, message, and deep cause; stack is environment noise. */
const errorsEqual = (actual: object, expected: object, pairs: ComparisonPairs): boolean => {
  if (!(actual instanceof Error) || !(expected instanceof Error)) {
    return false
  }
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) {
    return false
  }
  return (
    actual.name === expected.name &&
    actual.message === expected.message &&
    deepEqualGuarded(actual.cause, expected.cause, pairs)
  )
}

/**
 * Tracks the object pairs currently being compared on the traversal path,
 * so cyclic structures terminate instead of recursing forever.
 */
class ComparisonPairs {
  private readonly pairs = new WeakMap<object, WeakSet<object>>()

  isComparing(actual: object, expected: object): boolean {
    return this.pairs.get(actual)?.has(expected) ?? false
  }

  begin(actual: object, expected: object): void {
    let compared = this.pairs.get(actual)
    if (compared === undefined) {
      compared = new WeakSet<object>()
      this.pairs.set(actual, compared)
    }
    compared.add(expected)
  }

  end(actual: object, expected: object): void {
    this.pairs.get(actual)?.delete(expected)
  }
}

const TYPED_ARRAY_CONSTRUCTORS: ReadonlySet<unknown> = new Set<unknown>([
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
])

const isTypedArray = (value: unknown): value is ArrayBufferView & { constructor: unknown } =>
  typeof value === 'object' && value !== null && TYPED_ARRAY_CONSTRUCTORS.has(value.constructor)

const typedArraysEqual = (actual: object, expected: object): boolean => {
  if (!isTypedArray(actual) || !isTypedArray(expected)) {
    return false
  }
  if (actual.constructor !== expected.constructor) {
    return false
  }
  if (actual.byteLength !== expected.byteLength) {
    return false
  }
  const leftBytes = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength)
  const rightBytes = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength)
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return false
    }
  }
  return true
}

/**
 * Whether a Map key or Set member can be matched against a collection with
 * `has`/`get` (SameValueZero) instead of a linear deep-equal scan. This holds
 * for every value where SameValueZero agrees with the `Object.is` semantics
 * `deepEqual` uses for primitives — which is every primitive except the two
 * zero signs, since `SameValueZero(0, -0)` is `true` but `Object.is(0, -0)`
 * is `false`. Because a collection can hold at most one of `0`/`-0` (they
 * collapse under SameValueZero at insertion time) and its non-zero primitive
 * members are already mutually SameValueZero-distinct, a `has`/`get` match
 * on one of these values can never be shared by two different actual
 * members, so no consumption bookkeeping is needed for them.
 */
const canMatchByIdentity = (value: unknown): boolean =>
  (typeof value !== 'object' || value === null) && !(typeof value === 'number' && value === 0)

const mapsEqual = (actual: object, expected: object, pairs: ComparisonPairs): boolean => {
  if (!(actual instanceof Map) || !(expected instanceof Map)) {
    return false
  }
  if (actual.size !== expected.size) {
    return false
  }
  // Entries whose key cannot be matched by identity are matched against this
  // consumable pool, so a single expected entry cannot satisfy two distinct
  // actual entries.
  const remaining = [...expected.entries()].filter(([key]) => !canMatchByIdentity(key))
  for (const [key, value] of actual) {
    if (canMatchByIdentity(key)) {
      if (!expected.has(key) || !deepEqualGuarded(value, expected.get(key), pairs)) {
        return false
      }
      continue
    }
    const matchIndex = remaining.findIndex(
      ([otherKey, otherValue]) => deepEqualGuarded(key, otherKey, pairs) && deepEqualGuarded(value, otherValue, pairs),
    )
    if (matchIndex === -1) {
      return false
    }
    remaining.splice(matchIndex, 1)
  }
  return true
}

const setsEqual = (actual: object, expected: object, pairs: ComparisonPairs): boolean => {
  if (!(actual instanceof Set) || !(expected instanceof Set)) {
    return false
  }
  if (actual.size !== expected.size) {
    return false
  }
  // Members that cannot be matched by identity are matched against this
  // consumable pool, so a single expected member cannot satisfy two distinct
  // actual members (the greedy, non-consuming match this replaces could
  // accept `new Set([{a:1},{a:1}])` against `new Set([{a:1},{a:2}])`, since
  // both actual members would independently "find" the same `{a:1}`).
  const remaining = [...expected.values()].filter((value) => !canMatchByIdentity(value))
  for (const member of actual) {
    if (canMatchByIdentity(member)) {
      if (!expected.has(member)) {
        return false
      }
      continue
    }
    const matchIndex = remaining.findIndex((other) => deepEqualGuarded(member, other, pairs))
    if (matchIndex === -1) {
      return false
    }
    remaining.splice(matchIndex, 1)
  }
  return true
}

const arraysEqual = (actual: object, expected: object, pairs: ComparisonPairs): boolean => {
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    return false
  }
  if (actual.length !== expected.length) {
    return false
  }
  for (let index = 0; index < actual.length; index += 1) {
    const presentInActual = index in actual
    const presentInExpected = index in expected
    if (presentInActual !== presentInExpected) {
      return false
    }
    if (presentInActual && !deepEqualGuarded(actual[index], expected[index], pairs)) {
      return false
    }
  }
  return true
}

const objectsEqual = (actual: object, expected: object, pairs: ComparisonPairs): boolean => {
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) {
    return false
  }
  const actualKeys = Reflect.ownKeys(actual)
  const expectedKeys = Reflect.ownKeys(expected)
  if (actualKeys.length !== expectedKeys.length) {
    return false
  }
  for (const key of actualKeys) {
    if (!Object.hasOwn(expected, key)) {
      return false
    }
    const left = (actual as Record<PropertyKey, unknown>)[key]
    const right = (expected as Record<PropertyKey, unknown>)[key]
    if (!deepEqualGuarded(left, right, pairs)) {
      return false
    }
  }
  return true
}
