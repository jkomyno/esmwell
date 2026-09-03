import type { ConsoleChunk, ConsoleLevel } from './types'
import { defineRunesmGlobal } from './runtime-globals'

/** Receives captured console output. */
export interface ConsoleSink {
  write(chunk: ConsoleChunk): void
}

interface BoundedConsoleSink extends ConsoleSink {
  readonly isTruncated: boolean
}

interface SerializationState {
  readonly seen: WeakSet<object>
  remainingNodes: number
}

/** How deep the serializer descends into nested structures. */
const MAX_SERIALIZATION_DEPTH = 3
const MAX_SERIALIZED_ITEMS = 100
const MAX_SERIALIZED_NODES = 256
const MAX_SERIALIZED_STRING_LENGTH = 8 * 1024
const MAX_CONSOLE_CHARACTERS = 64 * 1024
// Per-chunk and per-part allowances the budget charges on top of the parts
// themselves, so a caller's rendering overhead cannot escape the cap.
const CONSOLE_CHUNK_OVERHEAD_CHARACTERS = 16
const CONSOLE_PART_SEPARATOR_CHARACTERS = 1
const CONSOLE_TRUNCATION_MESSAGE = `[Console output truncated after ${MAX_CONSOLE_CHARACTERS} characters]`
const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']

let protectedConsole: Console | undefined
let protectedConsoleSink: BoundedConsoleSink | undefined
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
        if (sink.isTruncated) return
        sink.write({
          level,
          parts: formatConsoleArguments(args),
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
  return serializeWithState(value, depth, {
    seen: new WeakSet<object>(),
    remainingNodes: MAX_SERIALIZED_NODES,
  })
}

const serializeWithState = (value: unknown, depth: number, state: SerializationState): string => {
  try {
    return serializeValueGuarded(value, depth, state)
  } catch {
    return '[Unserializable]'
  }
}

const serializeValueGuarded = (value: unknown, depth: number, state: SerializationState): string => {
  if (state.remainingNodes === 0) return '…'
  state.remainingNodes -= 1

  switch (typeof value) {
    case 'string':
      return depth === 0 ? truncateString(value) : quoteString(truncateString(value))
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
  if (state.seen.has(value)) {
    return '[Circular]'
  }
  state.seen.add(value)
  try {
    return serializeObject(value, depth, state)
  } finally {
    state.seen.delete(value)
  }
}

const serializeObject = (value: object, depth: number, state: SerializationState): string => {
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
    const entries: string[] = []
    for (const [key, entryValue] of value) {
      if (entries.length === MAX_SERIALIZED_ITEMS || state.remainingNodes === 0) break
      entries.push(
        `${serializeValueGuarded(key, depth + 1, state)} => ${serializeValueGuarded(entryValue, depth + 1, state)}`,
      )
    }
    appendOmittedCount(entries, value.size, entries.length)
    return `Map(${value.size}) { ${entries.join(', ')} }`
  }
  if (value instanceof Set) {
    if (depth >= MAX_SERIALIZATION_DEPTH) {
      return '[Set]'
    }
    const members: string[] = []
    for (const member of value) {
      if (members.length === MAX_SERIALIZED_ITEMS || state.remainingNodes === 0) break
      members.push(serializeValueGuarded(member, depth + 1, state))
    }
    appendOmittedCount(members, value.size, members.length)
    return `Set(${value.size}) { ${members.join(', ')} }`
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_SERIALIZATION_DEPTH) {
      return '[Array]'
    }
    const elements: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (elements.length === MAX_SERIALIZED_ITEMS || state.remainingNodes === 0) break
      elements.push(serializeValueGuarded(value[index], depth + 1, state))
    }
    appendOmittedCount(elements, value.length, elements.length)
    return `[${elements.join(', ')}]`
  }
  if (isTypedArrayView(value)) {
    if (depth >= MAX_SERIALIZATION_DEPTH) {
      return `[${value.constructor.name}]`
    }
    const elements: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (elements.length === MAX_SERIALIZED_ITEMS || state.remainingNodes === 0) break
      elements.push(serializeValueGuarded(value[index], depth + 1, state))
    }
    appendOmittedCount(elements, value.length, elements.length)
    return `${value.constructor.name}(${value.length}) [${elements.join(', ')}]`
  }
  if (depth >= MAX_SERIALIZATION_DEPTH) {
    return '[Object]'
  }
  const keys = Object.keys(value)
  const entries: string[] = []
  for (const key of keys) {
    if (entries.length === MAX_SERIALIZED_ITEMS || state.remainingNodes === 0) break
    entries.push(`${formatKey(key)}: ${serializeValueGuarded(Reflect.get(value, key), depth + 1, state)}`)
  }
  appendOmittedCount(entries, keys.length, entries.length)
  return `{ ${entries.join(', ')} }`
}

const truncateString = (value: string): string =>
  value.length <= MAX_SERIALIZED_STRING_LENGTH ? value : `${value.slice(0, MAX_SERIALIZED_STRING_LENGTH)}…`

const appendOmittedCount = (parts: string[], total: number, included: number): void => {
  if (total > included) {
    parts.push(`… ${total - included} more`)
  }
}

/**
 * Formats one console call's arguments the way the runner does before it
 * streams them as a `ConsoleChunk`: each argument becomes one part, sharing
 * a node budget and circular-reference tracking. Hosts that print console
 * output from their own workers can reuse it for identical rendering.
 */
export function formatConsoleArguments(args: readonly unknown[]): string[] {
  const state: SerializationState = {
    seen: new WeakSet<object>(),
    remainingNodes: MAX_SERIALIZED_NODES,
  }
  const parts: string[] = []
  for (const argument of args) {
    if (parts.length === MAX_SERIALIZED_ITEMS || state.remainingNodes === 0) break
    parts.push(serializeWithState(argument, 0, state))
  }
  if (args.length > parts.length) {
    parts.push(`… ${args.length - parts.length} more arguments`)
  }
  return parts
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

// Quotes a human-facing preview. Generated module source uses `edits.ts`'s
// stricter source-code quoter instead.
const quoteString = (value: string): string => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

/**
 * Replaces the console methods with capture shims forwarding to `sink`, and
 * returns a restore function putting the originals back. Console output
 * during a run is captured instead of printed.
 */
export function installConsoleCapture(sink: ConsoleSink): () => void {
  const boundedSink = createBoundedConsoleSink(sink)
  if (protectedConsole !== undefined) {
    if (protectedConsoleCaptureActive) {
      throw new Error('console capture is already active in this execution worker')
    }
    protectedConsoleCaptureActive = true
    protectedConsoleSink = boundedSink
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
      if (boundedSink.isTruncated) return
      boundedSink.write({
        level,
        parts: formatConsoleArguments(args),
      })
    }
  }

  return () => {
    for (const [level, original] of originals) {
      consoleObject[level] = original as typeof consoleObject.log
    }
  }
}

const chunkCharacterCost = (parts: readonly string[]): number =>
  CONSOLE_CHUNK_OVERHEAD_CHARACTERS +
  parts.reduce((total, part) => total + part.length + CONSOLE_PART_SEPARATOR_CHARACTERS, 0)

/**
 * Keeps the parts that still fit in `budget` and clips the first one that does
 * not, so a call larger than the whole budget still shows a prefix instead of
 * vanishing behind the truncation notice.
 */
const clipParts = (parts: readonly string[], budget: number): string[] => {
  const clipped: string[] = []
  let used = 0
  for (const part of parts) {
    const cost = part.length + CONSOLE_PART_SEPARATOR_CHARACTERS
    if (used + cost <= budget) {
      clipped.push(part)
      used += cost
      continue
    }
    const room = budget - used - CONSOLE_PART_SEPARATOR_CHARACTERS
    if (room > 0) clipped.push(`${part.slice(0, room)}…`)
    break
  }
  return clipped
}

const createBoundedConsoleSink = (sink: ConsoleSink): BoundedConsoleSink => {
  let usedCharacters = 0
  let truncated = false

  return {
    get isTruncated(): boolean {
      return truncated
    },
    write(chunk): void {
      if (truncated) return

      const remaining = MAX_CONSOLE_CHARACTERS - usedCharacters
      const chunkCharacters = chunkCharacterCost(chunk.parts)
      if (chunkCharacters <= remaining) {
        usedCharacters += chunkCharacters
        sink.write(chunk)
        return
      }

      truncated = true
      const clipped = clipParts(chunk.parts, remaining - CONSOLE_CHUNK_OVERHEAD_CHARACTERS)
      if (clipped.length > 0) {
        sink.write({ ...chunk, parts: clipped })
      }
      sink.write({ level: 'warn', parts: [CONSOLE_TRUNCATION_MESSAGE] })
    },
  }
}
