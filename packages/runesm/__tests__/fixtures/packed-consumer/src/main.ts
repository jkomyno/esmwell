import { adaptWorker, createRunesm, createTestSession } from 'runesm'
import { isBareSpecifier } from 'runesm/utils'
import ExecutionWorkerUrl from './execution-worker?worker&url'
import ModuleServiceWorkerUrl from './module-service-worker?worker&url'
import TestWorkerUrl from './test-worker?worker&url'
import RunesmWorker from './worker?worker'

const session = createRunesm({
  workerFactory: () => adaptWorker(new RunesmWorker()),
  executionWorkerUrl: ExecutionWorkerUrl,
})
const tests = createTestSession({
  workerUrl: TestWorkerUrl,
  serviceWorkerUrl: ModuleServiceWorkerUrl,
})

if (!isBareSpecifier('effect')) throw new Error('runesm/utils was not bundled')

session.close()
tests.close()
