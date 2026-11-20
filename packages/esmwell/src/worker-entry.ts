import { createWorkerSupervisor } from './supervisor'
import type { SupervisedRequestKind } from './supervisor'
import type { WorkerRequest } from './types'
import { createModuleWorker } from './worker-like'

interface CoordinatorWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as CoordinatorWorkerScope
const allowedRequestKinds = new Set<SupervisedRequestKind>(['judge', 'repl-input', 'repl-reset'])
const postToPage = scope.postMessage.bind(scope)
const supervisor = createWorkerSupervisor({
  host: { send: postToPage },
  createWorker: createModuleWorker,
  defaultExecutionWorkerUrl: new URL(/* @vite-ignore */ 'execution-worker-entry.mjs', import.meta.url).href,
  allowedRequestKinds,
})

scope.addEventListener('message', (event): void => {
  supervisor.handle(event.data)
})
