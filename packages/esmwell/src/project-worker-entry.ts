import { installBrowserProcess } from './browser-process'
import { serializeError } from './bootstrap'
import { protectConsole, serializeValue } from './console'
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

  void runModuleProjectInRealm(request.project, {
    graphId: request.graphId,
    serviceWorkerScope: request.serviceWorkerScope,
    deps: request.deps,
    autoInstall: request.autoInstall,
    onConsoleChunk: (chunk) => {
      postToMain({ kind: 'console', id: request.id, chunk } satisfies WorkerResponse)
    },
  })
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
  const preview = {
    ...response,
    result: {
      ...result,
      exports: Object.fromEntries(
        Object.entries(result.exports).map(([name, value]) => [name, cloneableOrPreview(value)]),
      ),
    },
  } satisfies WorkerResponse
  if (tryPost(preview)) {
    return
  }
  tryPost({
    kind: 'module-project-result',
    id,
    result: projectErrorResult(new Error('module-project worker response could not be sent to the main thread')),
  })
}

const cloneableOrPreview = (value: unknown): unknown => {
  try {
    structuredClone(value)
    return value
  } catch {
    return serializeValue(value)
  }
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
  status: 'error',
  ok: false,
  exports: {},
  console: [],
  dependencies: [],
  error: serializeError(error),
  durationMs: 0,
})
