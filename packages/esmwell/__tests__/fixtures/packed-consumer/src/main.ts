import { adaptWorker, createEsmwell, createModuleProjectSession, createTestSession } from 'esmwell'
import { typescriptTransform } from 'esmwell/typescript'
import { isBareSpecifier } from 'esmwell/utils'
import ExecutionWorkerUrl from './execution-worker?worker&url'
import ModuleServiceWorkerUrl from './module-service-worker?worker&url'
import ProjectWorkerUrl from './project-worker?worker&url'
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
const projects = createModuleProjectSession({
  workerUrl: ProjectWorkerUrl,
  serviceWorkerUrl: ModuleServiceWorkerUrl,
})

if (!isBareSpecifier('effect')) throw new Error('esmwell/utils was not bundled')

session.close()
tests.close()
projects.close()
