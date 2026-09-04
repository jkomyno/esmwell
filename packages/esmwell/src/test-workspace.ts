import { materializeModuleGraph } from './module-graph'
import type { MaterializedModuleGraph } from './module-graph'
import type { ResolveOptions } from './resolve'
import { TEST_API_GLOBAL } from './test-engine'
import type { TestEngineName, TestModules } from './test-types'

const FRAMEWORK_MODULE_ID = '__esmwell_internal__/test-api'

/** Options for materializing one virtual ESM test workspace. */
export interface TestGraphOptions extends ResolveOptions {
  readonly engine: TestEngineName
  readonly modules: TestModules
  readonly testFiles: readonly string[]
  readonly graphId: string
  readonly serviceWorkerScope: string
}

/** A materialized graph ready for its test entries to be imported. */
export type MaterializedTestGraph = MaterializedModuleGraph

/** Materializes a test workspace through the shared virtual ESM graph. */
export const materializeTestGraph = (options: TestGraphOptions): Promise<MaterializedTestGraph> => {
  const expected = options.engine === 'vitest' ? 'vitest' : '@jest/globals'
  const unsupported = options.engine === 'vitest' ? '@jest/globals' : 'vitest'
  return materializeModuleGraph({
    modules: options.modules,
    entries: options.testFiles,
    graphId: options.graphId,
    serviceWorkerScope: options.serviceWorkerScope,
    deps: options.deps,
    autoInstall: options.autoInstall,
    internalModules: { [FRAMEWORK_MODULE_ID]: frameworkFacadeSource(options.engine) },
    specifierAliases: { [expected]: FRAMEWORK_MODULE_ID },
    blockedSpecifiers: {
      [unsupported]: `test engine '${options.engine}' cannot provide '${unsupported}' — import from '${expected}' instead`,
    },
    reservedLocalPrefixes: ['src/', 'tests/'],
    emptyEntriesMessage: 'a test workspace needs at least one test file',
    entryLabel: 'test entry',
  })
}

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
    `if (api === undefined) throw new Error('the ${engine} test API was imported outside an active esmwell test run')`,
    ...names.map((name) => `export const ${name} = api.${name}`),
  ].join('\n')
}
