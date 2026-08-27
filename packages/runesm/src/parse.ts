import { parse } from 'acorn'
import type { Options, Program } from 'acorn'

/**
 * A position in user-submitted code. Lines are 1-based, columns are 0-based,
 * mirroring acorn's positions.
 */
export interface SourcePosition {
  line: number
  column: number
}

/**
 * Syntax error in user-submitted code. Carries the offending position so
 * hosts can point the user at it.
 */
export class UserSyntaxError extends Error {
  /** 1-based line of the syntax error. */
  readonly line: number
  /** 0-based column of the syntax error. */
  readonly column: number

  constructor(message: string, position: SourcePosition) {
    super(`${message} (line ${position.line}, column ${position.column + 1})`)
    this.name = 'UserSyntaxError'
    this.line = position.line
    this.column = position.column
  }
}

const PARSE_OPTIONS: Options = {
  ecmaVersion: 2023,
  sourceType: 'module',
  locations: true,
  allowHashBang: true,
}

/**
 * Parses user-submitted code as an ES module, producing nodes with source
 * locations. Throws a {@link UserSyntaxError} when the code is not valid
 * module syntax.
 */
export function parseUserModule(code: string): Program {
  try {
    return parse(code, PARSE_OPTIONS)
  } catch (error) {
    throw new UserSyntaxError(cleanMessage(error), positionOf(error))
  }
}

const ACORN_LOCATION_SUFFIX = /\s*\(\d+:\d+\)\s*$/

const cleanMessage = (error: unknown): string => {
  if (error instanceof Error) {
    // acorn appends "(line:column)" to its messages; the position is
    // re-rendered by UserSyntaxError itself.
    return error.message.replace(ACORN_LOCATION_SUFFIX, '')
  }
  return 'could not parse the submitted code'
}

const positionOf = (error: unknown): SourcePosition => {
  if (typeof error === 'object' && error !== null && 'loc' in error) {
    const loc = (error as { loc: unknown }).loc
    if (
      typeof loc === 'object' &&
      loc !== null &&
      typeof (loc as { line?: unknown }).line === 'number' &&
      typeof (loc as { column?: unknown }).column === 'number'
    ) {
      return {
        line: (loc as { line: number }).line,
        column: (loc as { column: number }).column,
      }
    }
  }
  return { line: 1, column: 0 }
}
