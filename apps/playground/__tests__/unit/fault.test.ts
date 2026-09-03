import { checkPolicy, parseUserModule, UserSyntaxError } from 'esmwell'
import type { SerializedError } from 'esmwell'
import { describe, expect, it } from 'vitest'
import { describeWhere, faultKind, serializeThrown } from '../../src/fault'
import { TypeScriptCompileError } from '../../src/typescript-client'

/**
 * Line and column numbers move whenever a fixture is reindented, so assertions
 * compare the shape of a location rather than the coordinates inside it.
 */
const LOCATION_PATTERNS = [/\(line \d+, column \d+\)/gu, /\(line \d+\)/gu] as const

const sanitize = (message: string): string =>
  LOCATION_PATTERNS.reduce((text, pattern) => text.replace(pattern, '(<location>)'), message)

const thrownBy = (act: () => unknown): unknown => {
  try {
    act()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
}

describe('faultKind', () => {
  it('announces known runner errors in the reader’s vocabulary', () => {
    expect(faultKind({ name: 'UserSyntaxError', message: '' })).toBe('Syntax error')
    expect(faultKind({ name: 'PolicyViolation', message: '' })).toBe('Policy violation')
    expect(faultKind({ name: 'TypeScriptError', message: '' })).toBe('TypeScript error')
  })

  it('falls back to the error’s own name when it is not one the playground knows', () => {
    expect(faultKind({ name: 'RangeError', message: '' })).toBe('RangeError')
  })
})

describe('describeWhere', () => {
  it('adds nothing to a syntax error, whose message already carries its location', () => {
    const error = thrownBy(() => parseUserModule('const broken = ('))
    expect(error).toBeInstanceOf(UserSyntaxError)
    const serialized = serializeThrown(error)

    expect(sanitize(serialized.message)).toContain('(<location>)')
    expect(describeWhere(serialized)).toBeUndefined()
  })

  it('names the rule that fired without repeating the line the message already carries', () => {
    const [violation] = checkPolicy(parseUserModule('\nvar answer = 42\n'))
    expect(violation).toBeDefined()
    const serialized: SerializedError = {
      name: violation!.name,
      message: violation!.message,
      rule: violation!.rule,
      line: violation!.line,
    }

    expect(sanitize(serialized.message)).toContain('(<location>)')
    expect(describeWhere(serialized)).toBe('Rule var.')
  })

  it('adds nothing to a resolution failure, which names its own specifier and reason', () => {
    expect(
      describeWhere({
        name: 'SpecifierResolutionError',
        message: "could not resolve './local'",
        kind: 'unsupported',
        specifier: './local',
      }),
    ).toBeUndefined()
  })

  it('places a compiler diagnostic, the one error whose message omits its position', () => {
    const where = describeWhere(
      serializeThrown(
        new TypeScriptCompileError({
          category: 'error',
          code: 2322,
          message: "Type 'string' is not assignable to type 'number'.",
          start: 18,
          length: 6,
          line: 1,
          column: 18,
        }),
      ),
    )

    expect(where).toMatch(/^Line \d+, column \d+\.$/u)
  })

  it('reports a compiler diagnostic column as 1-based, matching what an editor shows', () => {
    const error = new TypeScriptCompileError({
      category: 'error',
      code: 2322,
      message: 'nope',
      start: 0,
      length: 1,
      line: 3,
      column: 0,
    })

    expect(describeWhere(serializeThrown(error))).toBe('Line 3, column 1.')
  })
})

describe('serializeThrown', () => {
  it('keeps a compiler diagnostic’s position so the fault can be placed', () => {
    const error = new TypeScriptCompileError({
      category: 'error',
      code: 1005,
      message: "';' expected.",
      start: 4,
      length: 1,
      line: 2,
      column: 7,
    })

    expect(serializeThrown(error)).toEqual({
      name: 'TypeScriptError',
      message: "TS1005: ';' expected.",
      line: 2,
      column: 7,
    })
  })

  it('carries a plain error across as name and message', () => {
    expect(serializeThrown(new RangeError('out of range'))).toEqual({
      name: 'RangeError',
      message: 'out of range',
    })
  })

  it('stringifies a thrown non-error', () => {
    expect(serializeThrown('just a string')).toEqual({ name: 'Error', message: 'just a string' })
  })
})
