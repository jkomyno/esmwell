/**
 * The module namespace of a dynamically imported module: named exports as
 * properties, plus `default` when present.
 */
export type ModuleNamespace = Record<string, unknown>

/**
 * Creates a URL the module system can import `code` from: a blob URL when
 * the platform provides `URL.createObjectURL`, a `data:` URL otherwise.
 */
export function createModuleUrl(code: string): string {
  if (typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  }
  return createDataModuleUrl(code)
}

/**
 * Creates a `data:` URL for `code`. Useful where blob URLs cannot be
 * imported (Node) or when a self-contained URL is preferred.
 */
export function createDataModuleUrl(code: string): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`
}

/** Dynamically imports a module from `url` and returns its namespace. */
export async function importModule(url: string): Promise<ModuleNamespace> {
  return (await import(url)) as ModuleNamespace
}

/** Looks up a named export in a module namespace without throwing. */
export function readNamedExport(module: ModuleNamespace, name: string): { found: boolean; value: unknown } {
  return name in module ? { found: true, value: module[name] } : { found: false, value: undefined }
}
