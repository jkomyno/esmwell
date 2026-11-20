import { installBrowserProcess } from './browser-process'
import { runWithWorkerBindings, workerFailure } from './bootstrap'
import { protectConsole } from './console'
import { runModuleProjectInRealm } from './module-project'
import type { ModuleProjectResult } from './module-project'
import type { ModuleProjectRequest, WorkerResponse } from './types'

interface ProjectWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<ModuleProjectRequest>) => void): void
}

const scope = self as unknown as ProjectWorkerScope
const postToMain = scope.postMessage.bind(scope)

installBrowserProcess()
protectConsole()

scope.addEventListener('message', (event): void => {
  const request = event.data
  if (request.kind !== 'module-project') {
    postResult(
      request.id,
      projectErrorResult(new Error(`module-project worker received request kind '${String(request.kind)}'`)),
    )
    return
  }

  void runWithWorkerBindings(request, postToMain, (handlers) =>
    runModuleProjectInRealm(request.project, {
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
      postResult(request.id, projectErrorResult(error))
    })
})

const postResult = (id: number, result: ModuleProjectResult): void => {
  const response = { kind: 'module-project-result', id, result } satisfies WorkerResponse
  if (tryPost(response)) {
    return
  }
  tryPost({
    kind: 'module-project-result',
    id,
    result: projectErrorResult(new Error('module-project worker response could not be sent to the main thread')),
  })
}

const tryPost = (response: WorkerResponse): boolean => {
  try {
    postToMain(response)
    return true
  } catch {
    return false
  }
}

const projectErrorResult = (error: unknown): ModuleProjectResult => ({
  ...workerFailure(error),
  status: 'error',
  exports: {},
})
