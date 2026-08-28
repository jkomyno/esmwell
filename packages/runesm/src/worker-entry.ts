import { createWorkerSupervisor } from './supervisor'
import type { ExecutionWorkerLike, SupervisedRequestKind } from './supervisor'
import type { WorkerRequest } from './types'

interface CoordinatorWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as CoordinatorWorkerScope
const allowedRequestKinds = new Set<SupervisedRequestKind>(['judge', 'repl-input', 'repl-reset'])
const postToPage = scope.postMessage.bind(scope)
const supervisor = createWorkerSupervisor({
  host: { send: postToPage },
  createWorker: (url): ExecutionWorkerLike => {
    const worker = new Worker(url, { type: 'module' })
    const postToWorker = worker.postMessage.bind(worker)
    return {
      send: postToWorker,
      terminate: () => worker.terminate(),
      addEventListener: (type, listener) => worker.addEventListener(type, listener as EventListener),
      removeEventListener: (type, listener) => worker.removeEventListener(type, listener as EventListener),
    }
  },
  defaultExecutionWorkerUrl: new URL(/* @vite-ignore */ 'execution-worker-entry.mjs', import.meta.url).href,
  allowedRequestKinds,
})

scope.addEventListener('message', (event): void => {
  supervisor.handle(event.data)
})
