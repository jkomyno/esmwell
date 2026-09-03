/**
 * Request/response plumbing between a page and a worker it owns: correlation
 * ids, a pending map, rejection of every in-flight request when the worker
 * fails, lazy start, and restart on the next request. Hosts that pair
 * esmwell with their own worker (a TypeScript language service, a formatter,
 * a linter) re-implement exactly this; here it is once, on both sides.
 */
import { adaptWorker, type WorkerLike } from './worker-like'

/** The envelope the client posts. */
export interface WorkerRpcRequest<Body> {
  readonly id: number
  readonly body: Body
}

/** The envelope the worker posts back. */
export type WorkerRpcReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly name: string; readonly message: string }

export interface WorkerRpcOptions {
  /**
   * Builds the worker. Called on the first request, and again after a
   * failure or `restart()` retired the previous one.
   */
  readonly createWorker: () => Worker | WorkerLike
}

export interface WorkerRpcRequestOptions {
  /** Rejects the request locally when aborted; the worker still finishes it. */
  readonly signal?: AbortSignal
}

export interface WorkerRpc<Request> {
  /**
   * Posts `body` and resolves with the handler's return value. The value is
   * whatever the worker replied, so the caller names the type it expects.
   */
  request<Value = unknown>(body: Request, options?: WorkerRpcRequestOptions): Promise<Value>
  /**
   * Terminates the worker and rejects every in-flight request with `reason`.
   * The next request starts a fresh worker.
   */
  restart(reason?: string): void
  /** Terminates the worker and rejects every request, now and later. */
  destroy(): void
  readonly destroyed: boolean
}

/** Rejection for a request that could not complete on the worker side. */
export class WorkerRpcError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

const DESTROYED_MESSAGE = 'worker rpc was destroyed'
const RESTARTED_MESSAGE = 'worker was restarted'

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly cleanup: () => void
}

const isWorkerLike = (worker: Worker | WorkerLike): worker is WorkerLike =>
  typeof (worker as WorkerLike).send === 'function'

/** Creates the page-side client of a worker RPC pair. */
export function createWorkerRpc<Request>(options: WorkerRpcOptions): WorkerRpc<Request> {
  const pending = new Map<number, Pending>()
  let worker: WorkerLike | undefined
  let nextId = 1
  let destroyed = false

  const rejectAll = (error: Error): void => {
    for (const entry of pending.values()) {
      entry.cleanup()
      entry.reject(error)
    }
    pending.clear()
  }

  const retire = (message: string): void => {
    const current = worker
    worker = undefined
    current?.terminate()
    rejectAll(new WorkerRpcError('WorkerRpcError', message))
  }

  const ensureWorker = (): WorkerLike => {
    if (worker !== undefined) {
      return worker
    }
    const created = options.createWorker()
    const adapted = isWorkerLike(created) ? created : adaptWorker(created)
    adapted.addEventListener('message', (event) => {
      if (adapted !== worker) {
        return
      }
      const reply = (event as MessageEvent<WorkerRpcReply>).data
      const entry = pending.get(reply?.id)
      if (entry === undefined) {
        return
      }
      pending.delete(reply.id)
      entry.cleanup()
      if (reply.ok) {
        entry.resolve(reply.value)
      } else {
        entry.reject(new WorkerRpcError(reply.name, reply.message))
      }
    })
    adapted.addEventListener('error', (event) => {
      if (adapted === worker) {
        retire((event as ErrorEvent).message || 'worker failed')
      }
    })
    adapted.addEventListener('messageerror', () => {
      if (adapted === worker) {
        retire('the worker sent a message the page could not decode (messageerror)')
      }
    })
    worker = adapted
    return adapted
  }

  return {
    get destroyed(): boolean {
      return destroyed
    },
    request<Value = unknown>(body: Request, requestOptions: WorkerRpcRequestOptions = {}): Promise<Value> {
      if (destroyed) {
        return Promise.reject(new WorkerRpcError('WorkerRpcError', DESTROYED_MESSAGE))
      }
      const { signal } = requestOptions
      if (signal?.aborted === true) {
        return Promise.reject(abortReason(signal))
      }
      let target: WorkerLike
      try {
        target = ensureWorker()
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
      const id = nextId
      nextId += 1
      return new Promise<Value>((resolve, reject) => {
        const onAbort = (): void => {
          pending.delete(id)
          reject(abortReason(signal))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          cleanup: () => signal?.removeEventListener('abort', onAbort),
        })
        try {
          target.send({ id, body } satisfies WorkerRpcRequest<Request>)
        } catch (error) {
          retire(`could not post the request to the worker: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    },
    restart(reason = RESTARTED_MESSAGE): void {
      if (!destroyed) {
        retire(reason)
      }
    },
    destroy(): void {
      if (destroyed) {
        return
      }
      destroyed = true
      retire(DESTROYED_MESSAGE)
    },
  }
}

const abortReason = (signal: AbortSignal | undefined): Error => {
  const reason: unknown = signal?.reason
  if (reason instanceof Error) {
    return reason
  }
  return new WorkerRpcError('AbortError', reason === undefined ? 'request was aborted' : String(reason))
}

/** The worker-global surface the server side needs; satisfied by `self` in a worker. */
export interface WorkerRpcScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

/**
 * Installs the worker side of the pair: every `{ id, body }` message goes to
 * `handler`, and its return value or thrown error is posted back under the
 * same id. Returns a function that stops serving.
 */
export function serveWorkerRpc<Request>(
  handler: (body: Request) => unknown,
  scope: WorkerRpcScope = self as unknown as WorkerRpcScope,
): () => void {
  const postToPage = scope.postMessage.bind(scope)
  const onMessage = (event: MessageEvent): void => {
    const request = event.data as WorkerRpcRequest<Request> | null
    if (typeof request?.id !== 'number') {
      return
    }
    Promise.resolve()
      .then(() => handler(request.body))
      .then(
        (value) => postToPage({ id: request.id, ok: true, value } satisfies WorkerRpcReply),
        (error: unknown) =>
          postToPage({
            id: request.id,
            ok: false,
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          } satisfies WorkerRpcReply),
      )
  }
  scope.addEventListener('message', onMessage)
  return () => scope.removeEventListener('message', onMessage)
}
