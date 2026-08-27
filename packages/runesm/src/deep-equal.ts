/**
 * Structural equality for judged values: primitives (with `Object.is`
 * semantics, so `NaN` equals `NaN` but `+0` does not equal `-0`), arrays,
 * plain objects (same prototype required), `Map`, `Set`, `Date`, and every
 * TypedArray class compared byte-wise. Functions compare by reference.
 * Cyclic structures are handled by tracking in-progress comparison pairs.
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

const mapsEqual = (actual: object, expected: object, pairs: ComparisonPairs): boolean => {
  if (!(actual instanceof Map) || !(expected instanceof Map)) {
    return false
  }
  if (actual.size !== expected.size) {
    return false
  }
  for (const [key, value] of actual) {
    const matchingEntry = [...expected.entries()].find(([otherKey]) => deepEqualGuarded(key, otherKey, pairs))
    if (matchingEntry === undefined) {
      return false
    }
    if (!deepEqualGuarded(value, matchingEntry[1], pairs)) {
      return false
    }
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
  for (const member of actual) {
    const hasMatch = [...expected.values()].some((other) => deepEqualGuarded(member, other, pairs))
    if (!hasMatch) {
      return false
    }
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
