import { installConsoleCapture } from './console'
import { serializeError } from './bootstrap'
import { TEST_API_GLOBAL } from './test-engine'
import { runJestTests } from './test-engines/jest'
import { runVitestInRealm } from './test-engines/vitest'
import { defineEsmwellGlobal } from './runtime-globals'
import { materializeTestGraph } from './test-workspace'
import type { ResolveOptions } from './resolve'
import type { ConsoleChunk } from './types'
import type { TestCaseResult, TestEngineInfo, TestEnginePackage, TestRun, TestRunResult } from './test-types'

/** Worker-realm options supplied by the main-thread test session. */
export interface TestRealmOptions extends ResolveOptions {
  readonly graphId: string
  readonly serviceWorkerScope: string
  readonly onConsoleChunk?: (chunk: ConsoleChunk) => void
}

/** Runs one virtual ESM workspace with official upstream test-engine packages. */
export async function runTestsInRealm(run: TestRun, options: TestRealmOptions): Promise<TestRunResult> {
  const startedAt = performance.now()
  const consoleChunks: ConsoleChunk[] = []
  const restoreConsole = installConsoleCapture({
    write: (chunk) => {
      consoleChunks.push(chunk)
      options.onConsoleChunk?.(chunk)
    },
  })
  let graph: Awaited<ReturnType<typeof materializeTestGraph>> | undefined

  try {
    graph = await materializeTestGraph({
      ...run,
      graphId: options.graphId,
      serviceWorkerScope: options.serviceWorkerScope,
      deps: options.deps,
      autoInstall: options.autoInstall,
    })
    const outcome = requireRegisteredTests(
      run.engine === 'vitest' ? await executeVitest(graph.entryUrls) : await executeJest(graph.entryUrls),
    )

    return {
      status: outcome.error === undefined ? (outcome.ok ? 'pass' : 'fail') : 'error',
      ok: outcome.ok,
      engine: outcome.engine,
      tests: outcome.tests,
      console: consoleChunks,
      dependencies: graph.dependencies,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
      durationMs: elapsedMs(startedAt),
    }
  } catch (error) {
    return {
      status: 'error',
      ok: false,
      tests: [],
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

export interface NormalizedEngineOutcome {
  readonly ok: boolean
  readonly engine: TestEngineInfo
  readonly tests: readonly TestCaseResult[]
  readonly error?: ReturnType<typeof serializeError>
}

/**
 * A workspace that registered no tests is broken, not passing: a mistyped
 * `describe`, an early `return`, or a callback that never ran leaves nothing
 * to judge. Existing engine errors keep their original details.
 */
export const requireRegisteredTests = (outcome: NormalizedEngineOutcome): NormalizedEngineOutcome => {
  if (outcome.error !== undefined || outcome.tests.length > 0) {
    return outcome
  }
  return {
    ...outcome,
    ok: false,
    error: {
      name: 'NoTestsError',
      message: `the ${outcome.engine.name} workspace registered no tests — check that each test file calls describe/it/test at module top level and that testFiles lists the right canonical ids`,
    },
  }
}

const executeVitest = async (entryUrls: readonly string[]): Promise<NormalizedEngineOutcome> => {
  const result = await runVitestInRealm({
    files: entryUrls,
    importTestFile: async (filepath, context) => {
      installTestApi(await importUrl(context.vitestUrl))
      return importUrl(filepath)
    },
  })
  const packages: TestEnginePackage[] =
    result.imports === undefined
      ? []
      : [
          { name: 'vitest', version: result.imports.version, url: result.imports.vitestUrl },
          { name: '@vitest/runner', version: result.imports.version, url: result.imports.runnerUrl },
          { name: '@vitest/expect', version: result.imports.version, url: result.imports.expectUrl },
        ]
  const version = result.version ?? 'unknown'
  const fileError = result.files.flatMap((file) => file.errors)[0]
  return {
    ok: result.ok,
    engine: { name: 'vitest', version, packages },
    tests: result.files.flatMap((file) =>
      file.tests.map((test) => ({
        id: test.id,
        name: test.name,
        fullName: test.fullName,
        status: test.status,
        durationMs: test.durationMs,
        errors: test.errors,
      })),
    ),
    ...(result.error === undefined && fileError === undefined ? {} : { error: result.error ?? fileError }),
  }
}

const executeJest = async (entryUrls: readonly string[]): Promise<NormalizedEngineOutcome> => {
  const result = await runJestTests(async (globals) => {
    installTestApi(globals)
    for (const entryUrl of entryUrls) {
      await importUrl(entryUrl)
    }
  })
  const version = result.runner.resolvedVersion
  const query = '?bundle&target=es2022'
  const unhandledError = result.unhandledErrors[0]
  return {
    ok: result.ok,
    engine: {
      name: 'jest',
      version,
      packages: ['jest-circus', 'expect', 'jest-mock'].map((name) => ({
        name,
        version,
        url: `https://esm.sh/${name}@${version}${query}`,
      })),
    },
    tests: result.tests.map((test, index) => ({
      id: `jest:${index}:${test.fullName}`,
      name: test.name,
      fullName: test.fullName,
      status:
        test.status === 'passed'
          ? 'pass'
          : test.status === 'failed'
            ? 'fail'
            : test.status === 'skipped'
              ? 'skip'
              : 'todo',
      durationMs: test.durationMs ?? 0,
      errors: test.errors,
    })),
    ...(result.error === undefined && unhandledError === undefined ? {} : { error: result.error ?? unhandledError }),
  }
}

const installTestApi = (value: unknown): void => {
  defineEsmwellGlobal(TEST_API_GLOBAL, value)
}

const importUrl = async (url: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ url)) as Record<string, unknown>

const elapsedMs = (startedAt: number): number => Math.round((performance.now() - startedAt) * 100) / 100
