import { serializeError } from './bootstrap'
import { installConsoleCapture } from './console'
import { materializeModuleGraph } from './module-graph'
import type { ResolveOptions } from './resolve'
import type { ResolvedDependency } from './resolve'
import type { ConsoleChunk, SerializedError } from './types'

/** Canonical ESM module id to JavaScript source. */
export type ModuleProjectModules = Readonly<Record<string, string>>

/** One virtual ESM project submitted to a module-project session. */
export interface ModuleProject {
  readonly modules: ModuleProjectModules
  /** Canonical id from `modules` to import as the project's sole entry. */
  readonly entry: string
}

/** Overall outcome of importing a module project's entry. */
export type ModuleProjectStatus = 'pass' | 'error'

/** Serializable result of one module-project run. */
export interface ModuleProjectResult {
  readonly status: ModuleProjectStatus
  readonly ok: boolean
  /** Entry-module exports. Non-cloneable values become display previews. */
  readonly exports: Readonly<Record<string, unknown>>
  readonly console: readonly ConsoleChunk[]
  readonly dependencies: readonly ResolvedDependency[]
  readonly error?: SerializedError
  readonly durationMs: number
}

/** Worker-realm options supplied by the main-thread project session. */
export interface ModuleProjectRealmOptions extends ResolveOptions {
  readonly graphId: string
  readonly serviceWorkerScope: string
  readonly onConsoleChunk?: (chunk: ConsoleChunk) => void
}

/** Materializes and imports one virtual ESM project inside its owned worker. */
export async function runModuleProjectInRealm(
  project: ModuleProject,
  options: ModuleProjectRealmOptions,
): Promise<ModuleProjectResult> {
  const startedAt = performance.now()
  const consoleChunks: ConsoleChunk[] = []
  const restoreConsole = installConsoleCapture({
    write: (chunk) => {
      consoleChunks.push(chunk)
      options.onConsoleChunk?.(chunk)
    },
  })
  let graph: Awaited<ReturnType<typeof materializeModuleGraph>> | undefined

  try {
    graph = await materializeModuleGraph({
      modules: project.modules,
      entries: [project.entry],
      graphId: options.graphId,
      serviceWorkerScope: options.serviceWorkerScope,
      deps: options.deps,
      autoInstall: options.autoInstall,
      reservedLocalPrefixes: ['src/', 'tests/'],
      entryLabel: 'entry',
    })
    const entry = await importUrl(graph.entryUrls[0]!)
    return {
      status: 'pass',
      ok: true,
      // Module namespace objects are exotic and cannot cross postMessage even
      // when every exported value can, so copy the bindings to a plain record.
      exports: Object.fromEntries(Object.entries(entry)),
      console: consoleChunks,
      dependencies: graph.dependencies,
      durationMs: elapsedMs(startedAt),
    }
  } catch (error) {
    return {
      status: 'error',
      ok: false,
      exports: {},
      console: consoleChunks,
      dependencies: graph?.dependencies ?? [],
      error: serializeError(error),
      durationMs: elapsedMs(startedAt),
    }
  } finally {
    if (graph !== undefined) {
      await graph.cleanup()
    }
    restoreConsole()
  }
}

const importUrl = async (url: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ url)) as Record<string, unknown>

const elapsedMs = (startedAt: number): number => Math.round((performance.now() - startedAt) * 100) / 100
