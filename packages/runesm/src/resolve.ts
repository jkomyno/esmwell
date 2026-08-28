/**
 * Options controlling how bare package specifiers resolve to CDN URLs.
 */
export interface ResolveOptions {
  /** Package name to pinned version, e.g. `{ 'lodash-es': '4.17.21' }`. */
  readonly deps?: Readonly<Record<string, string>>
  /**
   * Resolve bare specifiers that are not pinned in `deps` to the latest
   * version on the CDN (default `true`). When `false`, an unpinned bare
   * specifier is an error.
   */
  readonly autoInstall?: boolean
}

/** A bare package specifier after resolution, surfaced to hosts. */
export interface ResolvedDependency {
  /** The specifier as written in user code, e.g. `lodash-es/clone`. */
  readonly specifier: string
  /** The package name the specifier belongs to, e.g. `lodash-es`. */
  readonly name: string
  /** The version the specifier resolved to: pinned, or `latest`. */
  readonly version: string
  /** The full URL the specifier resolves to. */
  readonly url: string
}

/** Why a specifier could not be resolved. */
export type ResolutionFailureKind = 'node-module' | 'undeclared' | 'unsupported'

/** A specifier that cannot be resolved to a URL. */
export class SpecifierResolutionError extends Error {
  readonly specifier: string
  readonly kind: ResolutionFailureKind

  constructor(kind: ResolutionFailureKind, specifier: string, message: string) {
    super(message)
    this.name = 'SpecifierResolutionError'
    this.specifier = specifier
    this.kind = kind
  }
}

/** The result of resolving one import specifier. */
export interface ResolvedSpecifier {
  /** The URL to load the module from. */
  readonly url: string
  /** Dependency metadata for bare specifiers; absent for URL passthrough. */
  readonly dependency?: ResolvedDependency
}

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** Whether a specifier is a bare package name (possibly scoped, with subpath). */
export const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith('.') &&
  specifier !== '' &&
  !specifier.startsWith('/') &&
  !specifier.startsWith('#') &&
  !URL_SCHEME_PATTERN.test(specifier)

/** Whether a specifier is a full URL (e.g. `https://…`, `data:…`, `blob:…`). */
export const isUrlSpecifier = (specifier: string): boolean => URL_SCHEME_PATTERN.test(specifier)

/**
 * Splits a bare specifier into package name and optional subpath,
 * handling scoped packages: `@org/name/sub` → `@org/name` + `sub`.
 */
export const parseBareSpecifier = (specifier: string): { name: string; subpath: string | undefined } => {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    const scope = parts[0]
    const pkg = parts[1]
    if (scope !== undefined && pkg !== undefined) {
      return { name: `${scope}/${pkg}`, subpath: parts.slice(2).join('/') || undefined }
    }
  }
  return { name: parts[0] ?? specifier, subpath: parts.slice(1).join('/') || undefined }
}

/**
 * Resolves one import specifier to a URL:
 * - bare package specifiers (and scoped, with subpaths) resolve via esm.sh —
 *   pinned to the version in `deps` when present, otherwise `latest` when
 *   `autoInstall` is enabled, and an error when it is not
 * - a subpath with a `.`/`..`/empty segment, or a specifier containing `?`,
 *   `#`, or whitespace, errors: it would resolve a different package on the
 *   CDN than the one reported back to the caller
 * - an inline version suffix (npm's `package@version` syntax, e.g.
 *   `lodash-es@4`) errors: pin the version via `deps` instead
 * - `node:*` specifiers error with a module-specific message describing the
 *   browser alternative (or its absence)
 * - other absolute URLs pass through unchanged
 * - relative and import-map specifiers error: user code runs from an
 *   in-memory URL, so they have no meaningful base
 */
export function resolveImportSpecifier(specifier: string, options: ResolveOptions): ResolvedSpecifier {
  if (specifier.startsWith('node:')) {
    throw new SpecifierResolutionError('node-module', specifier, nodeModuleMessage(specifier))
  }

  if (isUrlSpecifier(specifier)) {
    return { url: specifier }
  }

  if (!isBareSpecifier(specifier)) {
    throw new SpecifierResolutionError(
      'unsupported',
      specifier,
      `could not resolve '${specifier}' — relative and import-map imports are not supported because submitted code runs from an in-memory URL; import a package by name or a full URL instead`,
    )
  }

  assertNoInvalidChars(specifier)

  const { name, subpath } = parseBareSpecifier(specifier)
  assertValidSubpath(specifier, subpath)
  assertNoInlineVersion(specifier, name)

  const pinnedVersion = options.deps !== undefined ? lookupOwnString(options.deps, name) : undefined
  if (pinnedVersion === undefined && options.autoInstall === false) {
    throw new SpecifierResolutionError(
      'undeclared',
      specifier,
      `could not resolve '${specifier}' — check the package name or add it to deps`,
    )
  }

  const version = pinnedVersion ?? 'latest'
  const url = esmShUrl(specifier, name, version, subpath)
  return {
    url,
    dependency: {
      specifier,
      name,
      version,
      url,
    },
  }
}

/**
 * Resolves every bare specifier in `specifiers`, returning the surfaced
 * dependency list (specifier → name → version → URL). Throws on the first
 * specifier that cannot be resolved.
 */
export function resolveDependencies(specifiers: Iterable<string>, options: ResolveOptions): ResolvedDependency[] {
  const dependencies: ResolvedDependency[] = []
  for (const specifier of specifiers) {
    const resolved = resolveImportSpecifier(specifier, options)
    if (resolved.dependency !== undefined) {
      dependencies.push(resolved.dependency)
    }
  }
  return dependencies
}

const esmShUrl = (specifier: string, name: string, version: string, subpath: string | undefined): string => {
  const base = `https://esm.sh/${name}@${version}`
  const url = subpath === undefined ? base : `${base}/${subpath}`

  // Belt-and-braces: the segments feeding this URL are already validated,
  // but a normalized URL can still disagree with naive string concatenation
  // (e.g. `.`/`..` collapsing). If it ever does, the reported dependency
  // would lie about what actually loaded, so treat that as an internal bug
  // rather than returning a mismatched URL.
  const normalizedPath = new URL(url).pathname
  const expectedPrefix = `/${name}@${version}`
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new Error(
      `internal error resolving '${specifier}': normalized URL '${url}' does not preserve the reported package prefix '${expectedPrefix}' — this is a bug in specifier validation`,
    )
  }

  return url
}

const INVALID_SPECIFIER_CHARS_PATTERN = /[?#\s]/

/** Rejects a specifier containing `?`, `#`, or whitespace anywhere. */
const assertNoInvalidChars = (specifier: string): void => {
  if (INVALID_SPECIFIER_CHARS_PATTERN.test(specifier)) {
    throw new SpecifierResolutionError(
      'unsupported',
      specifier,
      `could not resolve '${specifier}' — bare specifiers cannot contain '?', '#', or whitespace; the CDN URL would resolve a different package than the one reported`,
    )
  }
}

/** Rejects a subpath with a `.`, `..`, or empty segment (path traversal). */
const assertValidSubpath = (specifier: string, subpath: string | undefined): void => {
  if (subpath === undefined) {
    return
  }
  for (const segment of subpath.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SpecifierResolutionError(
        'unsupported',
        specifier,
        `could not resolve '${specifier}' — the subpath must not contain '.', '..', or empty segments`,
      )
    }
  }
}

/**
 * Finds the index of an inline version suffix in a package name, e.g. the
 * `@` in `lodash-es@4` or in `@scope/pkg@1.2.3`. Scoped packages
 * legitimately start with `@`, so only an `@` found after that leading
 * scope segment counts.
 */
const inlineVersionIndex = (name: string): number => {
  const searchFrom = name.startsWith('@') ? Math.max(name.indexOf('/') + 1, 1) : 0
  return name.indexOf('@', searchFrom)
}

/**
 * Rejects npm-install muscle memory like `import 'lodash-es@4'`: the
 * version would silently win over `deps` and would not match the reported
 * dependency version. Pin the version through `deps` instead.
 */
const assertNoInlineVersion = (specifier: string, name: string): void => {
  const at = inlineVersionIndex(name)
  if (at === -1) {
    return
  }
  const bareName = name.slice(0, at)
  throw new SpecifierResolutionError(
    'unsupported',
    specifier,
    `could not resolve '${specifier}' — bare specifiers cannot include an inline version like npm's 'package@version' syntax; import '${bareName}' and pin the version with the 'deps' option instead`,
  )
}

/** Own-property lookup that requires a string value and ignores anything found via the prototype chain (e.g. `constructor`, `toString`, `__proto__`). */
const lookupOwnString = (record: Readonly<Record<string, string>>, key: string): string | undefined => {
  if (!Object.hasOwn(record, key)) {
    return undefined
  }
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Tier 1/2 modules have browser shims planned; the alternative names the
 * closest native API to use in the meantime.
 */
const PLANNED_SHIMS: Readonly<Record<string, string>> = {
  'node:assert': 'the console and thrown Errors',
  'node:buffer': 'Uint8Array',
  'node:console': 'console',
  'node:crypto': 'globalThis.crypto',
  'node:diagnostics_channel': 'console diagnostics',
  'node:dns': 'fetch-based DNS-over-HTTPS services',
  'node:events': 'EventTarget or a userland emitter',
  'node:path': 'URL and string helpers',
  'node:perf_hooks': 'performance and PerformanceObserver',
  'node:process': 'a host-injected environment object',
  'node:punycode': 'URL with the unicode hostname option',
  'node:querystring': 'URLSearchParams',
  'node:stream': 'ReadableStream and WritableStream',
  'node:stream/web': 'ReadableStream and WritableStream',
  'node:string_decoder': 'TextDecoder',
  'node:timers': 'setTimeout, setInterval, and queueMicrotask',
  'node:timers/promises': 'await new Promise with setTimeout',
  'node:url': 'URL',
  'node:util': 'structuredClone and util-style helpers from packages',
  'node:util/types': 'value type checks on constructors',
  'node:worker_threads': 'Worker and MessageChannel',
  'node:zlib': 'CompressionStream and DecompressionStream',
}

/**
 * Tier 3 modules have no browser equivalent; each carries the closest
 * native pointer where one exists.
 */
const NO_EQUIVALENT_POINTERS: Readonly<Record<string, string>> = {
  'node:fs': 'browser code cannot touch the file system — store data with IndexedDB',
  'node:fs/promises': 'browser code cannot touch the file system — store data with IndexedDB',
  'node:module': 'ESM imports only, require() is not available; packages resolve via the CDN',
  'node:http': 'use fetch()',
  'node:https': 'use fetch()',
  'node:http2': 'use fetch()',
}

const nodeModuleMessage = (specifier: string): string => {
  const plannedAlternative = lookupOwnString(PLANNED_SHIMS, specifier)
  if (plannedAlternative !== undefined) {
    return `could not resolve '${specifier}' — no browser shim is available yet, but one is planned; meanwhile use ${plannedAlternative}`
  }
  const pointer = lookupOwnString(NO_EQUIVALENT_POINTERS, specifier)
  if (pointer !== undefined) {
    return `could not resolve '${specifier}' — it has no browser equivalent: ${pointer}`
  }
  return `could not resolve '${specifier}' — it has no browser equivalent; use web APIs instead`
}
