import { installBrowserProcess } from './browser-process'
import { runWithWorkerBindings, workerFailure } from './bootstrap'
import { protectConsole } from './console'
import { runTestsInRealm } from './test-runner'
import type { TestRunResult } from './test-types'
import type { TestRequest, WorkerResponse } from './types'

interface TestWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<TestRequest>) => void): void
}

const scope = self as unknown as TestWorkerScope
const postToMain = scope.postMessage.bind(scope)

installBrowserProcess()
protectConsole()

scope.addEventListener('message', (event): void => {
  const request = event.data
  if (request.kind !== 'test') {
    postResult(request.id, testErrorResult(new Error(`test worker received request kind '${String(request.kind)}'`)))
    return
  }

  void runWithWorkerBindings(request, postToMain, (handlers) =>
    runTestsInRealm(request.run, {
      graphId: request.graphId,
      serviceWorkerScope: request.serviceWorkerScope,
      deps: request.deps,
      autoInstall: request.autoInstall,
      ...handlers,
    }),
  )
    .then((result) => {
      postResult(request.id, result)
    })
    .catch((error: unknown) => {
      postResult(request.id, testErrorResult(error))
    })
})

const postResult = (id: number, result: TestRunResult): void => {
  postToMain({ kind: 'test-result', id, result } satisfies WorkerResponse)
}

const testErrorResult = (error: unknown): TestRunResult => ({ ...workerFailure(error), status: 'error', tests: [] })
