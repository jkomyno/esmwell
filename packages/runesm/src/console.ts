import type { ConsoleChunk, ConsoleLevel } from './types'
import { defineRunesmGlobal } from './runtime-globals'

/** Receives captured console output. */
export interface ConsoleSink {
  write(chunk: ConsoleChunk): void
}

/** How deep the serializer descends into nested structures. */
const MAX_SERIALIZATION_DEPTH = 3
const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']

let protectedConsole: Console | undefined
let protectedConsoleSink: ConsoleSink | undefined
let protectedConsoleCaptureActive = false

/**
 * Installs stable console methods before submitted code runs. The global
 * binding and captured methods cannot be replaced or deleted. A lexical sink
 * selects the active run without exposing runesm's capture state globally.
 */
export function protectConsole(): void {
  if (protectedConsole !== undefined) {
    return
  }

  const consoleObject = globalThis.console
  for (const level of CONSOLE_LEVELS) {
    const original = consoleObject[level].bind(consoleObject)
    Object.defineProperty(consoleObject, level, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: (...args: unknown[]): void => {
        const sink = protectedConsoleSink
        if (sink === undefined) {
          original(...args)
          return
        }
        sink.write({
          level,
          parts: args.map((argument) => serializeValue(argument)),
        })
      },
    })
  }
  defineRunesmGlobal('console', consoleObject)
  protectedConsole = consoleObject
}

/**
 * Serializes a value for display: primitives, strings (quoted inside
 * containers), containers with a depth cap, and honest previews for the
 * values that cannot be printed (promises, functions, circular references).
 */
export function serializeValue(value: unknown, depth: number = 0): string {
  return serializeValueGuarded(value, depth, new WeakSet<object>())
}

const serializeValueGuarded = (value: unknown, depth: number, seen: WeakSet<object>): string => {
  switch (typeof value) {
    case 'string':
      return depth === 0 ? value : quoteString(value)
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value)
    case 'bigint':
      return `${value}n`
    case 'boolean':
    case 'undefined':
      return String(value)
    case 'symbol':
      return value.toString()
    case 'function':
      return serializeFunction(value)
    case 'object':
      break
  }
  if (value === null) {
    return 'null'
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)
  try {
    return serializeObject(value, depth, seen)
  } finally {
    seen.delete(value)
  }
}

const serializeObject = (value: object, depth: number, seen: WeakSet<object>): string => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  }
  if (value instanceof RegExp) {
    return String(value)
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  if (value instanceof Promise || isThenable(value)) {
    return 'Promise { … }'
  }
  if (value instanceof Map) {
    if (depth >= MAX_SERIALIZATION_DEPTH) {
      return '[Map]'
    }
    const entries = [...value.entries()].map(
      ([key, entryValue]) =>
        `${serializeValueGuarded(key, depth + 1, seen)} => ${serializeValueGuarded(entryValue, depth + 1, seen)}`,
    )
    return `Map(${value.size}) { ${entries.join(', ')} }`
  }
  if (value instanceof Set) {
    if (depth >= MAX_SERIALIZATION_DEPTH) {
      return '[Set]'
    }
    const members = [...value.values()].map((member) => serializeValueGuarded(member, depth + 1, seen))
    return `Set(${value.size}) { ${members.join(', ')} }`
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_SERIALIZATION_DEPTH) {
      return '[Array]'
    }
    const elements = value.map((element) => serializeValueGuarded(element, depth + 1, seen))
    return `[${elements.join(', ')}]`
  }
  if (isTypedArrayView(value)) {
    if (depth >= MAX_SERIALIZATION_DEPTH) {
      return `[${value.constructor.name}]`
    }
    const elements = Array.from(value, (element) => serializeValueGuarded(element, depth + 1, seen))
    return `${value.constructor.name}(${value.length}) [${elements.join(', ')}]`
  }
  if (depth >= MAX_SERIALIZATION_DEPTH) {
    return '[Object]'
  }
  const entries = Object.entries(value).map(
    ([key, entryValue]) => `${formatKey(key)}: ${serializeValueGuarded(entryValue, depth + 1, seen)}`,
  )
  return `{ ${entries.join(', ')} }`
}

const serializeFunction = (value: Function): string => {
  const name = value.name === '' ? '(anonymous)' : value.name
  const kind = value.constructor?.name === 'AsyncFunction' ? 'async function' : 'function'
  return `[${kind} ${name}]`
}

const isThenable = (value: object): boolean =>
  'then' in value && typeof (value as { then?: unknown }).then === 'function'

const isTypedArrayView = (value: object): value is ArrayLike<number> & { constructor: { name: string } } =>
  ArrayBuffer.isView(value) && !(value instanceof DataView)

const IDENTIFIER_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const formatKey = (key: string): string => (IDENTIFIER_KEY_PATTERN.test(key) ? key : quoteString(key))

// Quotes a string for a human-facing preview, not for generated module
// source — see `edits.ts`'s `quoteString`, used by the transform modules for
// that purpose. The two bodies read the same today, but they serve
// different contracts (display vs. valid-JS-syntax generation) and may
// diverge, so keep them separate rather than merging them.
const quoteString = (value: string): string => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

/**
 * Replaces the console methods with capture shims forwarding to `sink`, and
 * returns a restore function putting the originals back. Console output
 * during a run is captured instead of printed.
 */
export function installConsoleCapture(sink: ConsoleSink): () => void {
  if (protectedConsole !== undefined) {
    if (protectedConsoleCaptureActive) {
      throw new Error('console capture is already active in this execution worker')
    }
    protectedConsoleCaptureActive = true
    protectedConsoleSink = sink
    return () => {
      protectedConsoleSink = undefined
      protectedConsoleCaptureActive = false
    }
  }

  const consoleObject = globalThis.console
  const originals = new Map<ConsoleLevel, (...args: unknown[]) => void>()

  for (const level of CONSOLE_LEVELS) {
    const original = consoleObject[level] as unknown as (...args: unknown[]) => void
    originals.set(level, original.bind(consoleObject))
    consoleObject[level] = (...args: unknown[]) => {
      sink.write({
        level,
        parts: args.map((argument) => serializeValue(argument)),
      })
    }
  }

  return () => {
    for (const [level, original] of originals) {
      consoleObject[level] = original as typeof consoleObject.log
    }
  }
}
