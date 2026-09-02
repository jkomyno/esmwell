import * as ts from 'typescript-legacy'
import { isBareSpecifier } from 'runesm/utils'

const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org'
const NPM_VERSION_RESOLVER_ORIGIN = 'https://data.jsdelivr.com/v1/package/resolve/npm'
const MAX_ARCHIVE_BYTES = 24_000_000
const MAX_UNPACKED_BYTES = 64_000_000
const MAX_DECLARATION_FILES = 1_024
const MAX_PACKAGES_PER_GRAPH = 24
const MAX_CACHED_ARCHIVES = 8
const MAX_CACHED_GRAPHS = 8
const MAX_CACHED_METADATA = 16
const TYPE_FETCH_TIMEOUT_MS = 15_000

type FetchType = (input: string | URL, init?: RequestInit) => Promise<Response>
type UnknownRecord = Record<string, unknown>

export interface TypeScriptTypeGraph {
  readonly files: readonly TypeScriptExtraLib[]
  readonly resolutions: readonly TypeScriptModuleResolution[]
  readonly complete: boolean
}

interface TypeScriptExtraLib {
  readonly fileName: string
  readonly content: string
}

interface TypeScriptModuleResolution {
  readonly specifier: string
  readonly fileName: string
  readonly containingFilePrefix?: string
}

interface PackageRequest {
  readonly reference: PackageReference
  readonly containingFilePrefix?: string
}

interface PackageReference {
  readonly original: string
  readonly packageName: string
  readonly subpath: string
  readonly versionReference: string
  readonly hasInlineVersion: boolean
}

interface PackageMetadata {
  readonly name: string
  readonly version: string
  readonly tarballUrl: string
  readonly types: string | undefined
  readonly exports: unknown
  readonly dependencies: Readonly<Record<string, string>>
}

interface PackageArchive {
  readonly metadata: PackageMetadata
  readonly declarations: ReadonlyMap<string, string>
}

const EMPTY_GRAPH: TypeScriptTypeGraph = { files: [], resolutions: [], complete: true }

const recent = <Key, Value>(cache: Map<Key, Value>, key: Key): Value | undefined => {
  const value = cache.get(key)
  if (value !== undefined) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

const remember = <Key, Value>(cache: Map<Key, Value>, key: Key, value: Value, limit: number): Value => {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) {
      break
    }
    cache.delete(oldest)
  }
  return value
}

const rememberRetryable = <Key, Value>(
  cache: Map<Key, Promise<Value | null>>,
  key: Key,
  pending: Promise<Value | null>,
  limit: number,
): Promise<Value | null> => {
  remember(cache, key, pending, limit)
  void pending.then((value) => {
    if (value === null && cache.get(key) === pending) {
      cache.delete(key)
    }
  })
  return pending
}

/**
 * One editor request scans the same source twice — once to place the caret, once
 * to collect its imports — so the latest scan is kept.
 */
let lastPreprocessed: { readonly source: string; readonly info: ts.PreProcessedFileInfo } | undefined

const preprocess = (source: string): ts.PreProcessedFileInfo => {
  if (lastPreprocessed?.source === source) {
    return lastPreprocessed.info
  }
  const info = ts.preProcessFile(source, true, true)
  lastPreprocessed = { source, info }
  return info
}

export const moduleSpecifiers = (source: string): readonly string[] => {
  const preprocessed = preprocess(source)
  return [
    ...new Set([
      ...preprocessed.importedFiles.map((file) => file.fileName),
      ...preprocessed.typeReferenceDirectives.map((file) => file.fileName),
    ]),
  ]
}

export const isModuleSpecifierPosition = (source: string, position: number): boolean =>
  preprocess(source).importedFiles.some((file) => position >= file.pos && position <= file.end)

const packageReference = (specifier: string): PackageReference | null => {
  if (!isBareSpecifier(specifier)) {
    return null
  }
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) {
    const packageSegment = segments[1]
    if (packageSegment === undefined || packageSegment === '') {
      return null
    }
    const versionAt = packageSegment.lastIndexOf('@')
    const packageBase = versionAt > 0 ? packageSegment.slice(0, versionAt) : packageSegment
    const packageName = `${segments[0]}/${packageBase}`
    const subpath = segments.slice(2).join('/')
    return {
      original: specifier,
      packageName,
      subpath,
      versionReference: versionAt > 0 ? packageSegment.slice(versionAt + 1) : 'latest',
      hasInlineVersion: versionAt > 0,
    }
  }
  const packageSegment = segments[0]
  if (packageSegment === undefined || packageSegment === '') {
    return null
  }
  const versionAt = packageSegment.lastIndexOf('@')
  const packageName = versionAt > 0 ? packageSegment.slice(0, versionAt) : packageSegment
  const subpath = segments.slice(1).join('/')
  return {
    original: specifier,
    packageName,
    subpath,
    versionReference: versionAt > 0 ? packageSegment.slice(versionAt + 1) : 'latest',
    hasInlineVersion: versionAt > 0,
  }
}

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : undefined

const stringMap = (value: unknown): Readonly<Record<string, string>> => {
  const record = asRecord(value)
  if (record === undefined) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

const metadataFrom = (value: unknown): PackageMetadata | null => {
  const metadata = asRecord(value)
  const dist = asRecord(metadata?.dist)
  if (typeof metadata?.name !== 'string' || typeof metadata.version !== 'string' || typeof dist?.tarball !== 'string') {
    return null
  }
  let tarballUrl: URL
  try {
    tarballUrl = new URL(dist.tarball)
  } catch {
    return null
  }
  if (tarballUrl.origin !== NPM_REGISTRY_ORIGIN || tarballUrl.protocol !== 'https:') {
    return null
  }
  return {
    name: metadata.name,
    version: metadata.version,
    tarballUrl: tarballUrl.href,
    types:
      typeof metadata.types === 'string'
        ? metadata.types
        : typeof metadata.typings === 'string'
          ? metadata.typings
          : undefined,
    exports: metadata.exports,
    dependencies: {
      ...stringMap(metadata.peerDependencies),
      ...stringMap(metadata.optionalDependencies),
      ...stringMap(metadata.dependencies),
    },
  }
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes).replaceAll('\0', '').trim()

const tarEntries = (bytes: Uint8Array): ReadonlyMap<string, string> => {
  const declarations = new Map<string, string>()
  let offset = 0
  let nextPath: string | undefined
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      break
    }
    const name = text(header.subarray(0, 100))
    const prefix = text(header.subarray(345, 500))
    const size = Number.parseInt(text(header.subarray(124, 136)) || '0', 8)
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > bytes.length) {
      break
    }
    const type = String.fromCharCode(header[156] ?? 0)
    const body = bytes.subarray(offset + 512, offset + 512 + size)
    const headerPath = prefix === '' ? name : `${prefix}/${name}`
    if (type === 'x') {
      nextPath = text(body).match(/(?:^|\n)\d+ path=([^\n]+)/u)?.[1]
    } else if (type === 'L') {
      nextPath = text(body)
    } else if (type === '0' || type === '\0') {
      const path = (nextPath ?? headerPath).replace(/^package\//u, '')
      nextPath = undefined
      if (
        !path.startsWith('/') &&
        !path.split('/').includes('..') &&
        (/\.d\.[cm]?ts$/iu.test(path) || path === 'package.json')
      ) {
        declarations.set(path, new TextDecoder().decode(body))
      }
    } else {
      nextPath = undefined
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return declarations
}

const readBounded = async (
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      total += result.value.byteLength
      if (total > maximumBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const exceedsContentLength = (response: Response, maximumBytes: number): boolean => {
  const contentLength = Number(response.headers.get('content-length'))
  return Number.isFinite(contentLength) && contentLength > maximumBytes
}

const declarationTarget = (target: string): readonly string[] => {
  const path = target.replace(/^\.\//u, '')
  if (/\.d\.[cm]?ts$/iu.test(path)) {
    return [path]
  }
  if (path.endsWith('.mjs')) {
    return [`${path.slice(0, -4)}.d.mts`]
  }
  if (path.endsWith('.cjs')) {
    return [`${path.slice(0, -4)}.d.cts`]
  }
  if (path.endsWith('.js')) {
    return [`${path.slice(0, -3)}.d.ts`, `${path.slice(0, -3)}.d.mts`, `${path.slice(0, -3)}.d.cts`]
  }
  if (path.endsWith('.mts')) {
    return [`${path.slice(0, -4)}.d.mts`]
  }
  if (path.endsWith('.cts')) {
    return [`${path.slice(0, -4)}.d.cts`]
  }
  if (path.endsWith('.ts')) {
    return [`${path.slice(0, -3)}.d.ts`]
  }
  return [path, `${path}.d.ts`, `${path}.d.mts`, `${path}.d.cts`, `${path}/index.d.ts`]
}

const conditionalTarget = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(conditionalTarget).find((candidate) => candidate !== undefined)
  }
  const record = asRecord(value)
  if (record === undefined) {
    return undefined
  }
  for (const condition of ['types', 'import', 'default', 'require']) {
    const target = conditionalTarget(record[condition])
    if (target !== undefined) {
      return target
    }
  }
  return Object.values(record)
    .map(conditionalTarget)
    .find((candidate) => candidate !== undefined)
}

const exportedTarget = (exportsField: unknown, subpath: string): string | undefined => {
  const key = subpath === '' ? '.' : `./${subpath}`
  const exportsRecord = asRecord(exportsField)
  if (exportsRecord === undefined || !Object.keys(exportsRecord).some((candidate) => candidate.startsWith('.'))) {
    return subpath === '' ? conditionalTarget(exportsField) : undefined
  }
  const exact = conditionalTarget(exportsRecord[key])
  if (exact !== undefined) {
    return exact
  }
  for (const [candidate, value] of Object.entries(exportsRecord)) {
    const star = candidate.indexOf('*')
    if (star === -1 || !key.startsWith(candidate.slice(0, star)) || !key.endsWith(candidate.slice(star + 1))) {
      continue
    }
    const wildcard = key.slice(star, key.length - (candidate.length - star - 1))
    const target = conditionalTarget(value)
    if (target !== undefined) {
      return target.replaceAll('*', wildcard)
    }
  }
  return undefined
}

const rootDeclaration = (reference: PackageReference, archive: PackageArchive): string | undefined => {
  const candidates = [
    exportedTarget(archive.metadata.exports, reference.subpath),
    reference.subpath === '' ? archive.metadata.types : undefined,
    reference.subpath === '' ? 'index.d.ts' : reference.subpath,
    reference.subpath === '' ? undefined : `dist/${reference.subpath}`,
  ]
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue
    }
    const declaration = declarationTarget(candidate).find((path) => archive.declarations.has(path))
    if (declaration !== undefined) {
      return declaration
    }
  }
  return undefined
}

const relativeDeclaration = (
  specifier: string,
  importer: string,
  declarations: ReadonlyMap<string, string>,
): string | undefined => {
  const target = new URL(specifier, `https://types.invalid/${importer}`).pathname.slice(1)
  return declarationTarget(target).find((candidate) => declarations.has(candidate))
}

/** The virtual root every acquired declaration file is mounted under. */
export const RUNESM_TYPES_ROOT = '/node_modules/.runesm-types/'

const virtualFileName = (archive: PackageArchive, declaration: string): string =>
  `${RUNESM_TYPES_ROOT}${archive.metadata.name}@${archive.metadata.version}/${declaration}`

const virtualPackagePrefix = (archive: PackageArchive): string => virtualFileName(archive, '')

export const typeResolutionKey = (specifier: string, containingFilePrefix?: string): string =>
  `${containingFilePrefix ?? ''}\0${specifier}`

const packageRequestKey = (request: PackageRequest): string =>
  `${request.containingFilePrefix ?? ''}\0${request.reference.packageName}@${request.reference.versionReference}/${request.reference.subpath}`

export class TypeScriptTypeAcquirer {
  readonly #fetch: FetchType
  readonly #fetchTimeoutMs: number
  readonly #metadata = new Map<string, Promise<PackageMetadata | null>>()
  readonly #archives = new Map<string, Promise<PackageArchive | null>>()
  readonly #graphs = new Map<string, Promise<TypeScriptTypeGraph>>()

  constructor(fetchType: FetchType = globalThis.fetch.bind(globalThis), fetchTimeoutMs = TYPE_FETCH_TIMEOUT_MS) {
    this.#fetch = fetchType
    this.#fetchTimeoutMs = fetchTimeoutMs
  }

  async acquire(source: string): Promise<TypeScriptTypeGraph> {
    const references = moduleSpecifiers(source)
      .map(packageReference)
      .filter((reference) => reference !== null)
    if (references.length === 0) {
      return EMPTY_GRAPH
    }
    const graphKey = references
      .map((reference) => reference.original)
      .toSorted()
      .join('\0')
    const cached = recent(this.#graphs, graphKey)
    if (cached !== undefined) {
      return cached
    }
    const pending = this.#acquire(references)
    remember(this.#graphs, graphKey, pending, MAX_CACHED_GRAPHS)
    void pending.then(
      (graph) => {
        if (!graph.complete && this.#graphs.get(graphKey) === pending) {
          this.#graphs.delete(graphKey)
        }
      },
      () => {
        if (this.#graphs.get(graphKey) === pending) {
          this.#graphs.delete(graphKey)
        }
      },
    )
    return pending
  }

  async #acquire(initialReferences: readonly PackageReference[]): Promise<TypeScriptTypeGraph> {
    const queue: PackageRequest[] = []
    const queuedRequests = new Set<string>()
    const enqueue = (request: PackageRequest): void => {
      const key = packageRequestKey(request)
      if (!queuedRequests.has(key)) {
        queuedRequests.add(key)
        queue.push(request)
      }
    }
    for (const reference of initialReferences) {
      enqueue({ reference })
    }
    const files = new Map<string, TypeScriptExtraLib>()
    const resolutions = new Map<string, TypeScriptModuleResolution>()
    const visitedRoots = new Set<string>()
    const visitedDeclarations = new Set<string>()
    const localArchives = new Map<string, Promise<PackageArchive | null>>()
    let complete = true
    let packages = 0

    while (queue.length > 0 && files.size < MAX_DECLARATION_FILES && packages < MAX_PACKAGES_PER_GRAPH) {
      const request = queue.shift()
      if (request === undefined) {
        continue
      }
      const { reference } = request
      packages += 1
      const archiveKey = `${reference.packageName}@${reference.versionReference}`
      const pendingArchive = localArchives.get(archiveKey) ?? this.#archive(reference)
      localArchives.set(archiveKey, pendingArchive)
      const archive = await pendingArchive
      if (archive === null) {
        complete = false
        continue
      }
      const root = rootDeclaration(reference, archive)
      if (root === undefined) {
        continue
      }
      const rootKey = `${archive.metadata.name}@${archive.metadata.version}/${root}`
      const resolution = {
        specifier: reference.original,
        fileName: virtualFileName(archive, root),
        ...(request.containingFilePrefix === undefined ? {} : { containingFilePrefix: request.containingFilePrefix }),
      }
      resolutions.set(typeResolutionKey(resolution.specifier, resolution.containingFilePrefix), resolution)
      if (visitedRoots.has(rootKey)) {
        continue
      }
      visitedRoots.add(rootKey)
      const declarationQueue = [root]
      while (declarationQueue.length > 0 && files.size < MAX_DECLARATION_FILES) {
        const declaration = declarationQueue.shift()
        if (declaration === undefined) {
          continue
        }
        const declarationKey = `${archive.metadata.name}@${archive.metadata.version}/${declaration}`
        if (visitedDeclarations.has(declarationKey)) {
          continue
        }
        visitedDeclarations.add(declarationKey)
        const content = archive.declarations.get(declaration)
        if (content === undefined) {
          continue
        }
        const fileName = virtualFileName(archive, declaration)
        files.set(fileName, { fileName, content })
        for (const dependency of moduleSpecifiers(content)) {
          if (dependency.startsWith('.')) {
            const relative = relativeDeclaration(dependency, declaration, archive.declarations)
            if (relative !== undefined) {
              declarationQueue.push(relative)
            }
            continue
          }
          const dependencyReference = packageReference(dependency)
          if (dependencyReference === null || dependencyReference.packageName === 'node') {
            continue
          }
          if (dependencyReference.packageName === archive.metadata.name) {
            const dependencyRoot = rootDeclaration(dependencyReference, archive)
            if (dependencyRoot !== undefined) {
              const dependencyResolution = {
                specifier: dependencyReference.original,
                fileName: virtualFileName(archive, dependencyRoot),
                containingFilePrefix: virtualPackagePrefix(archive),
              }
              resolutions.set(
                typeResolutionKey(dependencyResolution.specifier, dependencyResolution.containingFilePrefix),
                dependencyResolution,
              )
              declarationQueue.push(dependencyRoot)
            }
            continue
          }
          const requestedVersion = archive.metadata.dependencies[dependencyReference.packageName]
          enqueue({
            reference: {
              ...dependencyReference,
              versionReference:
                dependencyReference.hasInlineVersion || requestedVersion === undefined
                  ? dependencyReference.versionReference
                  : requestedVersion,
            },
            containingFilePrefix: virtualPackagePrefix(archive),
          })
        }
      }
      if (declarationQueue.length > 0) {
        complete = false
      }
    }

    if (queue.length > 0) {
      complete = false
    }

    return { files: [...files.values()], resolutions: [...resolutions.values()], complete }
  }

  #archive(reference: PackageReference): Promise<PackageArchive | null> {
    const metadataKey = `${reference.packageName}@${reference.versionReference}`
    const pendingMetadata =
      recent(this.#metadata, metadataKey) ??
      rememberRetryable(this.#metadata, metadataKey, this.#loadMetadata(reference), MAX_CACHED_METADATA)
    return pendingMetadata.then((metadata) => {
      if (metadata === null) {
        return null
      }
      const archiveKey = `${metadata.name}@${metadata.version}`
      return (
        recent(this.#archives, archiveKey) ??
        rememberRetryable(this.#archives, archiveKey, this.#loadArchive(metadata), MAX_CACHED_ARCHIVES)
      )
    })
  }

  async #request(input: string | URL): Promise<Response> {
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort()
        reject(new Error('Type acquisition request timed out'))
      }, this.#fetchTimeoutMs)
    })
    try {
      return await Promise.race([this.#fetch(input, { signal: controller.signal }), timeout])
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }

  async #loadMetadata(reference: PackageReference): Promise<PackageMetadata | null> {
    try {
      const version = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(reference.versionReference)
        ? reference.versionReference
        : await this.#resolveVersion(reference)
      if (version === null) {
        return null
      }
      const response = await this.#request(
        `${NPM_REGISTRY_ORIGIN}/${encodeURIComponent(reference.packageName)}/${encodeURIComponent(version)}`,
      )
      if (!response.ok) {
        return null
      }
      const metadata = metadataFrom(await response.json())
      return metadata?.name === reference.packageName ? metadata : null
    } catch {
      return null
    }
  }

  async #resolveVersion(reference: PackageReference): Promise<string | null> {
    const response = await this.#request(
      `${NPM_VERSION_RESOLVER_ORIGIN}/${reference.packageName}@${encodeURIComponent(reference.versionReference)}`,
    )
    if (!response.ok) {
      return null
    }
    const result = asRecord(await response.json())
    return typeof result?.version === 'string' ? result.version : null
  }

  async #loadArchive(metadata: PackageMetadata): Promise<PackageArchive | null> {
    try {
      const response = await this.#request(metadata.tarballUrl)
      if (!response.ok || response.body === null || exceedsContentLength(response, MAX_ARCHIVE_BYTES)) {
        return null
      }
      const compressed = await readBounded(response.body, MAX_ARCHIVE_BYTES)
      if (compressed === null) {
        return null
      }
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
      const unpacked = await readBounded(stream, MAX_UNPACKED_BYTES)
      if (unpacked === null) {
        return null
      }
      return { metadata, declarations: tarEntries(unpacked) }
    } catch {
      return null
    }
  }
}
