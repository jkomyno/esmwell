const INTERNAL_MODULE_PREFIX = '__esmwell_internal__/'
const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u

/** Validates a canonical virtual module id such as `src/impl`. */
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
  if (id.startsWith(INTERNAL_MODULE_PREFIX)) {
    throw new TypeError(`virtual module id '${id}' is reserved by esmwell`)
  }
}

/** Converts an editor path to a validated virtual id, stripping leading slashes and script extensions. */
export const canonicalModuleId = (path: string): string => {
  const id = path.replace(/^\/+/u, '').replace(SCRIPT_EXTENSION, '')
  assertCanonicalModuleId(id)
  return id
}

/** Builds a graph from editor files. Sources must already be executable JavaScript. */
export const createProjectModules = (
  files: Iterable<readonly [path: string, source: string]>,
): Record<string, string> => {
  const modules: Record<string, string> = Object.create(null)
  const paths = new Map<string, { path: string; source: string }>()
  for (const [path, source] of files) {
    const id = canonicalModuleId(path)
    const previous = paths.get(id)
    if (previous !== undefined) {
      throw new TypeError(`Conflicting module paths: ${previous.path} and ${path}`)
    }
    paths.set(id, { path, source })
    modules[id] = source
  }
  for (const [id, { path, source }] of paths) {
    if (!SCRIPT_EXTENSION.test(path)) continue
    const extension = /\.[cm][jt]s$/u.exec(path)?.[0].replace('t', 'j') ?? '.js'
    const alias = `${id}${extension}`
    if (Object.hasOwn(modules, alias)) {
      throw new TypeError(`Conflicting module alias: ${alias} from ${path} conflicts with ${paths.get(alias)?.path}`)
    }
    modules[alias] = source
  }
  return modules
}
