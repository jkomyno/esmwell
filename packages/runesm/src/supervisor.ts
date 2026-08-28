import type { ConsoleChunk, JudgeRequest, ReplInputRequest, WorkerRequest, WorkerResponse } from './types'

/** Worker surface used by a supervisor to control one execution realm. */
export interface ExecutionWorkerLike {
  send(message: unknown): void
  terminate(): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}

/** Creates one child execution worker. */
export type ExecutionWorkerFactory = (url: string) => ExecutionWorkerLike

/** Parent-worker surface used to forward results to the page. */
export interface SupervisorHost {
  send(message: unknown): void
}

/** Requests one supervisor entry is allowed to delegate. */
export type SupervisedRequestKind = WorkerRequest['kind']

/** Configuration for one supervisor worker entry. */
export interface SupervisorOptions {
  readonly host: SupervisorHost
  readonly createWorker: ExecutionWorkerFactory
  readonly defaultExecutionWorkerUrl: string
  readonly allowedRequestKinds: ReadonlySet<SupervisedRequestKind>
}

/** Handles page requests while keeping submitted code in child workers. */
export interface WorkerSupervisor {
  handle(request: WorkerRequest): void
  close(): void
}

type ExecutableRequest = JudgeRequest | ReplInputRequest
type FinalResponse = Exclude<WorkerResponse, { readonly kind: 'console' }>

interface ActiveExecution {
  readonly worker: ExecutionWorkerLike
  readonly finish: (response: FinalResponse, terminate: boolean) => void
}

/** Creates a supervisor with exact-once child settlement and timeout ownership. */
export function createWorkerSupervisor(options: SupervisorOptions): WorkerSupervisor {
  let active: ActiveExecution | undefined
  let replWorker: ExecutionWorkerLike | undefined

  const terminateWorker = (worker: ExecutionWorkerLike): void => {
    worker.terminate()
    if (replWorker === worker) {
      replWorker = undefined
    }
  }

  const handleReset = (request: Extract<WorkerRequest, { readonly kind: 'repl-reset' }>): void => {
    if (active !== undefined) {
      options.host.send(failureResponse(request, 'the execution supervisor is already running a request'))
      return
    }
    if (replWorker !== undefined) {
      terminateWorker(replWorker)
    }
    options.host.send({ kind: 'repl-ack', id: request.id } satisfies WorkerResponse)
  }

  const execute = (request: ExecutableRequest): void => {
    if (active !== undefined) {
      options.host.send(failureResponse(request, 'the execution supervisor is already running a request'))
      return
    }

    const persistent = request.kind === 'repl-input'
    let worker = persistent ? replWorker : undefined
    if (worker === undefined) {
      try {
        worker = options.createWorker(resolveExecutionWorkerUrl(request, options.defaultExecutionWorkerUrl))
      } catch (error) {
        options.host.send(
          failureResponse(
            request,
            `could not start the execution worker: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        return
      }
      if (persistent) {
        replWorker = worker
      }
    }

    const consoleChunks: ConsoleChunk[] = []
    const expectedKind = finalResponseKind(request)
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const onMessage = (event: unknown): void => {
      const response = (event as MessageEvent<WorkerResponse>).data
      if (response?.id !== request.id) {
        return
      }
      if (response.kind === 'console') {
        consoleChunks.push(response.chunk)
        options.host.send(response)
        return
      }
      if (response.kind === expectedKind) {
        finish(response, !persistent)
        return
      }
      finish(
        failureResponse(request, `execution worker responded with unexpected message kind '${String(response.kind)}'`),
        true,
      )
    }

    const onError = (event: unknown): void => {
      const message = String((event as ErrorEvent).message || 'execution worker failed')
      finish(failureResponse(request, message, consoleChunks), true)
    }

    const onMessageError = (): void => {
      finish(
        failureResponse(request, 'the execution worker sent a message the supervisor could not decode', consoleChunks),
        true,
      )
    }

    const finish = (response: FinalResponse, terminate: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onMessageError)
      if (active?.worker === worker) {
        active = undefined
      }
      if (terminate) {
        terminateWorker(worker)
      }
      options.host.send(response)
    }

    active = { worker, finish }
    timer = setTimeout(() => {
      finish(timeoutResponse(request, consoleChunks), true)
    }, request.timeoutMs)

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onMessageError)
    try {
      worker.send(request)
    } catch (error) {
      finish(
        failureResponse(
          request,
          `could not send the request to the execution worker: ${error instanceof Error ? error.message : String(error)}`,
          consoleChunks,
        ),
        true,
      )
    }
  }

  return {
    handle(request): void {
      if (!options.allowedRequestKinds.has(request.kind)) {
        options.host.send(
          failureResponse(request, `supervisor received unsupported request kind '${String(request.kind)}'`),
        )
        return
      }
      if (request.kind === 'repl-reset') {
        handleReset(request)
        return
      }
      if (request.kind === 'test') {
        options.host.send(failureResponse(request, 'test requests use a directly supervised disposable worker'))
        return
      }
      execute(request)
    },
    close(): void {
      if (active !== undefined) {
        terminateWorker(active.worker)
        active = undefined
      }
      if (replWorker !== undefined) {
        terminateWorker(replWorker)
      }
    },
  }
}

const resolveExecutionWorkerUrl = (request: ExecutableRequest, fallback: string): string => {
  const resolved = new URL(request.executionWorkerUrl ?? fallback, globalThis.location?.href)
  if (globalThis.location !== undefined && resolved.origin !== globalThis.location.origin) {
    throw new Error('the execution worker must be served from the website origin')
  }
  return resolved.href
}

const finalResponseKind = (request: ExecutableRequest): FinalResponse['kind'] => {
  if (request.kind === 'judge') {
    return 'result'
  }
  if (request.kind === 'repl-input') {
    return 'repl-result'
  }
  return 'test-result'
}

const failureResponse = (
  request: WorkerRequest,
  message: string,
  consoleChunks: readonly ConsoleChunk[] = [],
): FinalResponse => {
  const error = { name: 'RunesmError', message }
  if (request.kind === 'repl-input') {
    return {
      kind: 'repl-result',
      id: request.id,
      result: { ok: false, error, console: consoleChunks, dependencies: [], durationMs: 0 },
    }
  }
  if (request.kind === 'repl-reset') {
    return { kind: 'repl-ack', id: request.id }
  }
  if (request.kind === 'test') {
    return {
      kind: 'test-result',
      id: request.id,
      result: {
        status: 'error',
        ok: false,
        tests: [],
        error,
        console: consoleChunks,
        dependencies: [],
        durationMs: 0,
      },
    }
  }
  return {
    kind: 'result',
    id: request.id,
    result: {
      status: 'error',
      ok: false,
      cases: [],
      error,
      console: consoleChunks,
      dependencies: [],
      durationMs: 0,
    },
  }
}

const timeoutResponse = (request: ExecutableRequest, consoleChunks: readonly ConsoleChunk[]): FinalResponse => {
  const error = {
    name: 'TimeoutError',
    message: `execution timed out after ${request.timeoutMs}ms and its worker was terminated`,
  }
  if (request.kind === 'repl-input') {
    return {
      kind: 'repl-result',
      id: request.id,
      result: {
        ok: false,
        error,
        console: consoleChunks,
        dependencies: [],
        durationMs: request.timeoutMs,
      },
    }
  }
  return {
    kind: 'result',
    id: request.id,
    result: {
      status: 'error',
      ok: false,
      cases: [],
      error,
      console: consoleChunks,
      dependencies: [],
      durationMs: request.timeoutMs,
    },
  }
}
