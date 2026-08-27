/**
 * The module namespace of a dynamically imported module: named exports as
 * properties, plus `default` when present.
 */
export type ModuleNamespace = Record<string, unknown>

/**
 * Creates a URL the module system can import `code` from: a blob URL in
 * browser realms, a `data:` URL everywhere else (Node's ESM loader cannot
 * import blob URLs).
 */
export function createModuleUrl(code: string): string {
  if (isBrowserRealm() && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  }
  return createDataModuleUrl(code)
}

const isBrowserRealm = (): boolean =>
  typeof window !== 'undefined' ||
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined'

/**
 * Creates a `data:` URL for `code`, base64-encoded so the body is safe to
 * embed in generated imports (no quote or percent-sign hazards). Useful
 * where blob URLs cannot be imported (Node) or when a self-contained URL is
 * preferred.
 */
export function createDataModuleUrl(code: string): string {
  return `data:text/javascript;base64,${toBase64(code)}`
}

const toBase64 = (code: string): string => {
  const bytes = new TextEncoder().encode(code)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/** Dynamically imports a module from `url` and returns its namespace. */
export async function importModule(url: string): Promise<ModuleNamespace> {
  return (await import(url)) as ModuleNamespace
}

/** Looks up a named export in a module namespace without throwing. */
export function readNamedExport(module: ModuleNamespace, name: string): { found: boolean; value: unknown } {
  return name in module ? { found: true, value: module[name] } : { found: false, value: undefined }
}
