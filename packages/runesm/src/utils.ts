/**
 * Specifier helpers a host can use without pulling in the resolver. These
 * answer questions about the *shape* of an import specifier, so a host can
 * classify what a module references before deciding whether to resolve it.
 */

export { isBareSpecifier } from './resolve'
