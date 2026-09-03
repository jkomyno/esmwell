/**
 * Helpers a host can use without pulling in the runner: specifier shape
 * questions, the console formatter the runner uses for captured output, and
 * request/response plumbing for a worker the host owns.
 */

export { isBareSpecifier } from './resolve'
export { formatConsoleArguments, serializeValue } from './console'
export { adaptWorker } from './worker-like'
export type { WorkerLike } from './worker-like'
export { createWorkerRpc, serveWorkerRpc, WorkerRpcError } from './worker-rpc'
export type {
  WorkerRpc,
  WorkerRpcOptions,
  WorkerRpcReply,
  WorkerRpcRequest,
  WorkerRpcRequestOptions,
  WorkerRpcScope,
} from './worker-rpc'
