import type { Node, Program } from 'acorn'
import { applyEdits, quoteString } from './edits'
import type { SourceEdit } from './edits'
import { parseUserModule } from './parse'
import { checkPolicy } from './policy'
import { resolveImportSpecifier, SpecifierResolutionError } from './resolve'
import type { ResolvedDependency, ResolveOptions } from './resolve'
import { TEST_API_GLOBAL } from './test-engine'
import type { TestEngineName, TestModules } from './test-types'
import { readNodeChild, readNodeString, walkNodes } from './walk'

const GRAPH_DIRECTORY = '__runesm_graphs__/v1/'
const CACHE_PREFIX = 'runesm:test-graph:v1:'
const FRAMEWORK_MODULE_ID = '__runesm_internal__/test-api'
const JAVASCRIPT_TYPE = 'text/javascript; charset=utf-8'

/** Options for materializing one virtual ESM test workspace. */
export interface TestGraphOptions extends ResolveOptions {
  readonly engine: TestEngineName
  readonly modules: TestModules
  readonly testFiles: readonly string[]
  readonly graphId: string
  readonly serviceWorkerScope: string
}

/** A materialized graph ready for its test entries to be imported. */
export interface MaterializedTestGraph {
  readonly entryUrls: readonly string[]
  readonly dependencies: readonly ResolvedDependency[]
  readonly cacheName: string
  cleanup(): Promise<boolean>
}

/** Cache name shared with the narrowly scoped module service worker. */
export const testGraphCacheName = (graphId: string): string => `${CACHE_PREFIX}${graphId}`

/**
 * Validates, rewrites, and stores every virtual module before any entry is
 * imported. Stable same-origin URLs let the browser's native ESM linker own
 * cycles, live bindings, and evaluation order.
 */
export async function materializeTestGraph(options: TestGraphOptions): Promise<MaterializedTestGraph> {
  assertGraphId(options.graphId)
  const moduleIds = ownModuleIds(options.modules)
  const moduleIdSet = new Set(moduleIds)
  const graphBaseUrl = new URL(`${GRAPH_DIRECTORY}${options.graphId}/`, ensureTrailingSlash(options.serviceWorkerScope))
  const moduleUrl = (id: string): string => new URL(encodeModuleId(id), graphBaseUrl).href
  const frameworkUrl = moduleUrl(FRAMEWORK_MODULE_ID)
  const dependencies: ResolvedDependency[] = []
  const dependencyKeys = new Set<string>()
  const cacheName = testGraphCacheName(options.graphId)
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
      const transformed = transformWorkspaceModule(source, ast, id, {
        ...options,
        moduleIdSet,
        moduleUrl,
        frameworkUrl,
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
    await putModule(cache, frameworkUrl, frameworkFacadeSource(options.engine))

    const entryUrls = options.testFiles.map((id) => {
      assertCanonicalModuleId(id)
      if (!moduleIdSet.has(id)) {
        throw missingLocalModule(id, '<testFiles>')
      }
      return moduleUrl(id)
    })
    if (entryUrls.length === 0) {
      throw new Error('a test workspace needs at least one test file')
    }

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
  readonly engine: TestEngineName
  readonly moduleIdSet: ReadonlySet<string>
  readonly moduleUrl: (id: string) => string
  readonly frameworkUrl: string
}

interface WorkspaceTransform {
  readonly code: string
  readonly dependencies: readonly ResolvedDependency[]
}

const transformWorkspaceModule = (
  code: string,
  ast: Program,
  importerId: string,
  context: TransformContext,
): WorkspaceTransform => {
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
    const resolved = resolveWorkspaceSpecifier(specifier, importerId, context)
    edits.push({ start: source.start, end: source.end, replacement: quoteString(resolved.url) })
    if (resolved.dependency !== undefined) {
      dependencies.push(resolved.dependency)
    }
  })

  return { code: applyEdits(code, edits), dependencies }
}

const resolveWorkspaceSpecifier = (
  specifier: string,
  importerId: string,
  context: TransformContext,
): { readonly url: string; readonly dependency?: ResolvedDependency } => {
  const localId = specifier.startsWith('.') ? resolveRelativeModuleId(importerId, specifier) : specifier
  if (context.moduleIdSet.has(localId)) {
    return { url: context.moduleUrl(localId) }
  }
  if (specifier === 'vitest' || specifier === '@jest/globals') {
    const expected = context.engine === 'vitest' ? 'vitest' : '@jest/globals'
    if (specifier !== expected) {
      throw new SpecifierResolutionError(
        'unsupported',
        specifier,
        `test engine '${context.engine}' cannot provide '${specifier}' — import from '${expected}' instead`,
      )
    }
    return { url: context.frameworkUrl }
  }
  if (isReservedLocalId(localId) || specifier.startsWith('.')) {
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
          `could not resolve '${specifier}' from '${importerId}' — the import escapes the virtual workspace root`,
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

const ownModuleIds = (modules: TestModules): string[] => {
  const ids = Object.keys(modules)
  for (const id of ids) {
    assertCanonicalModuleId(id)
  }
  return ids
}

/** Validates a canonical workspace module id such as `src/impl`. */
export const assertCanonicalModuleId = (id: string): void => {
  const hasForbiddenCharacter = [...id].some(
    (character) => character === '\\' || character === '?' || character === '#' || character.charCodeAt(0) <= 31,
  )
  if (id === '' || id.startsWith('/') || id.endsWith('/') || hasForbiddenCharacter) {
    throw new TypeError(`invalid virtual module id '${id}' — use canonical ids such as 'src/impl'`)
  }
  const segments = id.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`invalid virtual module id '${id}' — '.', '..', and empty path segments are not allowed`)
  }
  if (id === FRAMEWORK_MODULE_ID) {
    throw new TypeError(`virtual module id '${id}' is reserved by runesm`)
  }
}

const assertGraphId = (graphId: string): void => {
  if (!/^[a-f0-9-]+$/i.test(graphId)) {
    throw new TypeError('test graph id must contain only hexadecimal digits and hyphens')
  }
}

const isReservedLocalId = (id: string): boolean => id.startsWith('src/') || id.startsWith('tests/')

const encodeModuleId = (id: string): string => id.split('/').map(encodeURIComponent).join('/') + '.mjs'

const ensureTrailingSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`)

const putModule = (cache: Cache, url: string, source: string): Promise<void> =>
  cache.put(url, new Response(source, { headers: { 'content-type': JAVASCRIPT_TYPE } }))

const frameworkFacadeSource = (engine: TestEngineName): string => {
  const names =
    engine === 'vitest'
      ? [
          'suite',
          'describe',
          'it',
          'test',
          'beforeAll',
          'afterAll',
          'beforeEach',
          'afterEach',
          'expect',
          'assert',
          'expectTypeOf',
          'vi',
        ]
      : ['describe', 'it', 'test', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach', 'expect', 'jest']
  return [
    `const api = globalThis[${JSON.stringify(TEST_API_GLOBAL)}]`,
    `if (api === undefined) throw new Error('the ${engine} test API was imported outside an active runesm test run')`,
    ...names.map((name) => `export const ${name} = api.${name}`),
  ].join('\n')
}

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
