import { assertCanonicalModuleId } from './module-ids'
export { assertCanonicalModuleId } from './module-ids'
import type { Node, Program } from 'acorn'
import { applyEdits, quoteString } from './edits'
import type { SourceEdit } from './edits'
import { importMetaMainEdits } from './import-meta'
import { moduleGraphCacheName } from './module-graph-cache'
import { parseUserModule } from './parse'
import { checkPolicy } from './policy'
import { lookupOwnString, resolveImportSpecifier, SpecifierResolutionError } from './resolve'
import type { ResolvedDependency, ResolveOptions } from './resolve'
import { readNodeChild, readNodeString, walkNodes } from './walk'

export { moduleGraphCacheName } from './module-graph-cache'

const GRAPH_DIRECTORY = '__esmwell_graphs__/v1/'
const JAVASCRIPT_TYPE = 'text/javascript; charset=utf-8'

/** Options for materializing one same-origin virtual ESM graph. */
export interface ModuleGraphOptions extends ResolveOptions {
  readonly modules: Readonly<Record<string, string>>
  readonly entries: readonly string[]
  readonly graphId: string
  readonly serviceWorkerScope: string
  readonly internalModules?: Readonly<Record<string, string>>
  readonly specifierAliases?: Readonly<Record<string, string>>
  readonly blockedSpecifiers?: Readonly<Record<string, string>>
  readonly reservedLocalPrefixes?: readonly string[]
  readonly emptyEntriesMessage?: string
  readonly entryLabel?: string
}

/** A materialized graph ready for its entries to be imported. */
export interface MaterializedModuleGraph {
  readonly entryUrls: readonly string[]
  readonly dependencies: readonly ResolvedDependency[]
  readonly cacheName: string
  cleanup(): Promise<boolean>
}

/**
 * Validates, rewrites, and stores every virtual module before any entry is
 * imported. Stable same-origin URLs let the browser's native ESM linker own
 * cycles, live bindings, and evaluation order.
 */
export async function materializeModuleGraph(options: ModuleGraphOptions): Promise<MaterializedModuleGraph> {
  assertGraphId(options.graphId)
  const moduleIds = ownModuleIds(options.modules)
  const moduleIdSet = new Set(moduleIds)
  const mainModuleIds = mainModuleIdsOf(options.modules, options.entries)
  const graphBaseUrl = new URL(`${GRAPH_DIRECTORY}${options.graphId}/`, ensureTrailingSlash(options.serviceWorkerScope))
  const moduleUrl = (id: string): string => new URL(encodeModuleId(id), graphBaseUrl).href
  const dependencies: ResolvedDependency[] = []
  const dependencyKeys = new Set<string>()
  const cacheName = moduleGraphCacheName(options.graphId)
  const cache = await caches.open(cacheName)

  try {
    for (const id of moduleIds) {
      const source = options.modules[id]
      if (typeof source !== 'string') {
        throw new TypeError(`virtual module '${id}' must contain JavaScript source text`)
      }
      const ast = parseUserModule(source)
      const violation = checkPolicy(ast)[0]
      if (violation !== undefined) {
        throw violation
      }
      const transformed = transformModuleGraphSource(source, ast, id, {
        ...options,
        moduleIdSet,
        mainModuleIds,
        moduleUrl,
      })
      for (const dependency of transformed.dependencies) {
        const key = `${dependency.specifier}\0${dependency.url}`
        if (!dependencyKeys.has(key)) {
          dependencyKeys.add(key)
          dependencies.push(dependency)
        }
      }
      await putModule(cache, moduleUrl(id), transformed.code)
    }
    for (const [id, source] of Object.entries(options.internalModules ?? {})) {
      await putModule(cache, moduleUrl(id), source)
    }

    if (options.entries.length === 0) {
      throw new Error(options.emptyEntriesMessage ?? 'a module graph needs at least one entry')
    }
    const entryUrls = options.entries.map((id) => {
      assertCanonicalModuleId(id)
      if (!moduleIdSet.has(id)) {
        const label = options.entryLabel ?? 'entry'
        throw new SpecifierResolutionError(
          'unsupported',
          id,
          `could not find ${label} module '${id}' — add that canonical id to modules`,
        )
      }
      return moduleUrl(id)
    })

    return {
      entryUrls,
      dependencies,
      cacheName,
      cleanup: () => caches.delete(cacheName),
    }
  } catch (error) {
    await caches.delete(cacheName)
    throw error
  }
}

interface TransformContext extends ResolveOptions {
  readonly moduleIdSet: ReadonlySet<string>
  /** Modules whose `import.meta.main` is `true`: the entries and their extension aliases. */
  readonly mainModuleIds: ReadonlySet<string>
  readonly moduleUrl: (id: string) => string
  readonly specifierAliases?: Readonly<Record<string, string>>
  readonly blockedSpecifiers?: Readonly<Record<string, string>>
  readonly reservedLocalPrefixes?: readonly string[]
}

interface ModuleGraphTransform {
  readonly code: string
  readonly dependencies: readonly ResolvedDependency[]
}

export const transformModuleGraphSource = (
  code: string,
  ast: Program,
  importerId: string,
  context: TransformContext,
): ModuleGraphTransform => {
  const edits: SourceEdit[] = []
  const dependencies: ResolvedDependency[] = []

  walkNodes(ast, (node) => {
    const source = moduleSourceNode(node)
    if (source === null || source.type !== 'Literal') {
      return
    }
    const specifier = readNodeString(source, 'value')
    if (specifier === undefined) {
      return
    }
    const resolved = resolveGraphSpecifier(specifier, importerId, context)
    edits.push({ start: source.start, end: source.end, replacement: quoteString(resolved.url) })
    if (resolved.dependency !== undefined) {
      dependencies.push(resolved.dependency)
    }
  })

  edits.push(...importMetaMainEdits(code, ast, context.mainModuleIds.has(importerId)))

  return { code: applyEdits(code, edits), dependencies }
}

const SCRIPT_EXTENSION = /\.[cm]?js$/

/**
 * The entries plus every alias of an entry. A project may register one
 * source under a canonical id and under its `.js`, `.mjs`, or `.cjs` twin so that
 * extension-suffixed relative imports resolve. The twin is a separate module
 * instance to the ESM linker, and it reports the same `import.meta.main` as
 * the id it aliases rather than a second, different main.
 */
const mainModuleIdsOf = (
  modules: Readonly<Record<string, string>>,
  entries: readonly string[],
): ReadonlySet<string> => {
  const mainIds = new Set<string>()
  for (const entry of entries) {
    const entryStem = entry.replace(SCRIPT_EXTENSION, '')
    for (const id of Object.keys(modules)) {
      const aliasesEntry = id.replace(SCRIPT_EXTENSION, '') === entryStem && modules[id] === modules[entry]
      if (id === entry || aliasesEntry) {
        mainIds.add(id)
      }
    }
  }
  return mainIds
}

const resolveGraphSpecifier = (
  specifier: string,
  importerId: string,
  context: TransformContext,
): { readonly url: string; readonly dependency?: ResolvedDependency } => {
  if (specifier === 'process' || specifier.startsWith('node:')) {
    return resolveImportSpecifier(specifier, context)
  }
  const localId = specifier.startsWith('.') ? resolveRelativeModuleId(importerId, specifier) : specifier
  if (context.moduleIdSet.has(localId)) {
    return { url: context.moduleUrl(localId) }
  }
  const aliasId =
    context.specifierAliases === undefined ? undefined : lookupOwnString(context.specifierAliases, specifier)
  if (aliasId !== undefined) {
    return { url: context.moduleUrl(aliasId) }
  }
  const blockedMessage =
    context.blockedSpecifiers === undefined ? undefined : lookupOwnString(context.blockedSpecifiers, specifier)
  if (blockedMessage !== undefined) {
    throw new SpecifierResolutionError('unsupported', specifier, blockedMessage)
  }
  if (
    specifier.startsWith('.') ||
    context.reservedLocalPrefixes?.some((prefix) => localId.startsWith(prefix)) === true
  ) {
    throw missingLocalModule(localId, importerId)
  }
  return resolveImportSpecifier(specifier, context)
}

const resolveRelativeModuleId = (importerId: string, specifier: string): string => {
  const base = importerId.split('/').slice(0, -1)
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (base.pop() === undefined) {
        throw new SpecifierResolutionError(
          'unsupported',
          specifier,
          `could not resolve '${specifier}' from '${importerId}' — the import escapes the virtual module root`,
        )
      }
      continue
    }
    base.push(segment)
  }
  return base.join('/')
}

const missingLocalModule = (id: string, importerId: string): SpecifierResolutionError =>
  new SpecifierResolutionError(
    'unsupported',
    id,
    `could not find local module '${id}' imported from '${importerId}' — add that canonical id to modules`,
  )

const ownModuleIds = (modules: Readonly<Record<string, string>>): string[] => {
  const ids = Object.keys(modules)
  for (const id of ids) {
    assertCanonicalModuleId(id)
  }
  return ids
}

const assertGraphId = (graphId: string): void => {
  if (!/^[a-f0-9-]+$/i.test(graphId)) {
    throw new TypeError('module graph id must contain only hexadecimal digits and hyphens')
  }
}

const encodeModuleId = (id: string): string => id.split('/').map(encodeURIComponent).join('/') + '.mjs'

const ensureTrailingSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`)

const putModule = (cache: Cache, url: string, source: string): Promise<void> =>
  cache.put(url, new Response(source, { headers: { 'content-type': JAVASCRIPT_TYPE } }))

const moduleSourceNode = (node: Node): Node | null => {
  switch (node.type) {
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration':
    case 'ImportExpression':
      return readNodeChild(node, 'source')
    default:
      return null
  }
}
