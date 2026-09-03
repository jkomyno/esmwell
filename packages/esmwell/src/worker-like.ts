/** The worker surface the session transport needs; satisfied by a real module Worker. */
export interface WorkerLike {
  send(message: unknown): void
  terminate(): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}

/**
 * Adapts a real Worker (for example one built by a bundler's `?worker`
 * import) to the surface the session transport expects.
 */
export function adaptWorker(worker: Worker): WorkerLike {
  const postToWorker = worker.postMessage.bind(worker)
  return {
    send: (message: unknown) => {
      postToWorker(message)
    },
    terminate: () => {
      worker.terminate()
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      worker.addEventListener(type, listener as EventListener)
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      worker.removeEventListener(type, listener as EventListener)
    },
  }
}
