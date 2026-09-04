import type { SerializedError } from 'esmwell'
import { TypeScriptCompileError } from './typescript-client'

const FAULT_KINDS: Readonly<Record<string, string>> = {
  UserSyntaxError: 'Syntax error',
  PolicyViolation: 'Policy violation',
  SpecifierResolutionError: 'Unresolved import',
  TimeoutError: 'Timed out',
  TypeScriptError: 'TypeScript error',
}

/** The heading a fault is announced under, falling back to the error's own name. */
export const faultKind = (error: SerializedError): string => FAULT_KINDS[error.name] ?? error.name

export const serializeThrown = (error: unknown): SerializedError => {
  if (error instanceof TypeScriptCompileError) {
    return { name: error.name, message: error.message, line: error.line, column: error.column }
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  return { name: 'Error', message: String(error) }
}

/**
 * The detail the error's own message does not already carry. esmwell keeps its
 * messages self-contained: a resolution failure names its specifier and reason,
 * a syntax error appends its own line and column, and a policy violation appends
 * its own line — so only the rule that fired is news. A compiler diagnostic is
 * the one error whose message omits its position.
 */
export const describeWhere = (error: SerializedError): string | undefined => {
  if (error.rule !== undefined) {
    return `Rule ${error.rule}.`
  }
  if (error.name === 'TypeScriptError' && error.line !== undefined && error.column !== undefined) {
    return `Line ${error.line}, column ${error.column + 1}.`
  }
  return undefined
}
