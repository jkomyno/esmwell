import { adaptWorker, createEsmwell, createTestSession } from 'esmwell'
import { typescriptTransform } from 'esmwell/typescript'
import { createTypeScriptModuleScanner, TypeScriptTypeAcquirer } from 'esmwell/typescript-editor'
import { isBareSpecifier } from 'esmwell/utils'
import ExecutionWorkerUrl from './execution-worker?worker&url'
import ModuleServiceWorkerUrl from './module-service-worker?worker&url'
import TestWorkerUrl from './test-worker?worker&url'
import EsmwellWorker from './worker?worker'

const session = createEsmwell({
  workerFactory: () => adaptWorker(new EsmwellWorker()),
  executionWorkerUrl: ExecutionWorkerUrl,
  // The consumer has no `typescript` package; the transform must still bundle
  // and simply report the compiler as unavailable when a run needs it.
  transform: typescriptTransform({ load: () => Promise.reject(new Error('typescript is not installed here')) }),
})
const tests = createTestSession({
  workerUrl: TestWorkerUrl,
  serviceWorkerUrl: ModuleServiceWorkerUrl,
})

if (!isBareSpecifier('effect')) throw new Error('esmwell/utils was not bundled')

const scanner = createTypeScriptModuleScanner({
  preProcessFile: () => ({ importedFiles: [], typeReferenceDirectives: [] }),
})
const typeAcquirer = new TypeScriptTypeAcquirer({ scanner })
if (scanner.moduleSpecifiers('').length !== 0 || !(typeAcquirer instanceof TypeScriptTypeAcquirer)) {
  throw new Error('esmwell/typescript-editor was not bundled')
}

session.close()
tests.close()
