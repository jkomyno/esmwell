import { createWorkerRpc, serveWorkerRpc, WorkerRpcError } from 'src/worker-rpc'
import type { WorkerRpcReply, WorkerRpcRequest, WorkerRpcScope } from 'src/worker-rpc'
import type { WorkerLike } from 'src/worker-like'

type Listener = (event: unknown) => void

/** A fake worker whose `send` is answered by an in-memory server scope. */
class LinkedWorker implements WorkerLike {
  readonly sent: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly scopeListeners = new Set<(event: MessageEvent) => void>()

  /** The worker-global surface, wired back to this worker's page-side listeners. */
  readonly scope: WorkerRpcScope = {
    postMessage: (message) => {
      this.emit('message', { data: message })
    },
    addEventListener: (_type, listener) => {
      this.scopeListeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      this.scopeListeners.delete(listener)
    },
  }

  send(message: unknown): void {
    this.sent.push(message)
    for (const listener of this.scopeListeners) listener({ data: structuredClone(message) } as MessageEvent)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

type EchoRequest = { readonly op: 'double'; readonly value: number } | { readonly op: 'fail' } | { readonly op: 'slow' }

const echoHandler = async (body: EchoRequest): Promise<unknown> => {
  switch (body.op) {
    case 'double':
      return body.value * 2
    case 'fail':
      throw new RangeError('handler failed')
    case 'slow':
      return new Promise(() => {})
  }
}

describe('worker rpc: request/reply', () => {
  it('correlates replies by id and resolves the handler value', async () => {
    const worker = new LinkedWorker()
    serveWorkerRpc<EchoRequest>(echoHandler, worker.scope)
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => worker })

    const [first, second] = await Promise.all([
      rpc.request<number>({ op: 'double', value: 2 }),
      rpc.request<number>({ op: 'double', value: 5 }),
    ])

    expect([first, second]).toEqual([4, 10])
    expect(worker.sent).toEqual([
      { id: 1, body: { op: 'double', value: 2 } },
      { id: 2, body: { op: 'double', value: 5 } },
    ] satisfies WorkerRpcRequest<EchoRequest>[])
  })

  it('rejects with the handler error name and message', async () => {
    const worker = new LinkedWorker()
    serveWorkerRpc<EchoRequest>(echoHandler, worker.scope)
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => worker })

    const failure = await rpc.request({ op: 'fail' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WorkerRpcError)
    expect(failure).toMatchObject({ name: 'RangeError', message: 'handler failed' })
  })

  it('starts the worker lazily and only once', async () => {
    let created = 0
    const worker = new LinkedWorker()
    serveWorkerRpc<EchoRequest>(echoHandler, worker.scope)
    const rpc = createWorkerRpc<EchoRequest>({
      createWorker: () => {
        created += 1
        return worker
      },
    })

    expect(created).toBe(0)
    await rpc.request({ op: 'double', value: 1 })
    await rpc.request({ op: 'double', value: 1 })
    expect(created).toBe(1)
  })

  it('ignores replies that carry an unknown id', async () => {
    const worker = new LinkedWorker()
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => worker })

    const pending = rpc.request<number>({ op: 'double', value: 1 })
    worker.emit('message', { data: { id: 99, ok: true, value: 'stale' } satisfies WorkerRpcReply })
    worker.emit('message', { data: { id: 1, ok: true, value: 2 } satisfies WorkerRpcReply })

    await expect(pending).resolves.toBe(2)
  })
})

describe('worker rpc: lifecycle', () => {
  it('rejects in-flight requests when the worker errors and starts a fresh one next time', async () => {
    const broken = new LinkedWorker()
    const healthy = new LinkedWorker()
    serveWorkerRpc<EchoRequest>(echoHandler, healthy.scope)
    const workers = [broken, healthy]
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => workers.shift() ?? healthy })

    const hung = rpc.request({ op: 'slow' })
    broken.emit('error', { message: 'worker crashed' })

    await expect(hung).rejects.toMatchObject({ name: 'WorkerRpcError', message: 'worker crashed' })
    expect(broken.terminated).toBe(true)
    await expect(rpc.request<number>({ op: 'double', value: 3 })).resolves.toBe(6)
  })

  it('restart terminates the worker and rejects everything in flight with the reason', async () => {
    const worker = new LinkedWorker()
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => worker })

    const pending = rpc.request({ op: 'slow' })
    rpc.restart('source changed')

    await expect(pending).rejects.toMatchObject({ message: 'source changed' })
    expect(worker.terminated).toBe(true)
    expect(rpc.destroyed).toBe(false)
  })

  it('destroy rejects in-flight and later requests', async () => {
    const worker = new LinkedWorker()
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => worker })

    const pending = rpc.request({ op: 'slow' })
    rpc.destroy()

    await expect(pending).rejects.toMatchObject({ message: 'worker rpc was destroyed' })
    await expect(rpc.request({ op: 'double', value: 1 })).rejects.toMatchObject({ message: 'worker rpc was destroyed' })
    expect(rpc.destroyed).toBe(true)
  })

  it('rejects a request whose signal aborts, leaving later replies for that id unanswered', async () => {
    const worker = new LinkedWorker()
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => worker })
    const controller = new AbortController()

    const pending = rpc.request({ op: 'slow' }, { signal: controller.signal })
    controller.abort(new Error('superseded'))

    await expect(pending).rejects.toMatchObject({ message: 'superseded' })
    // The late reply finds no pending entry and is dropped; ids keep advancing.
    worker.emit('message', { data: { id: 1, ok: true, value: 'late' } satisfies WorkerRpcReply })
    void rpc.request({ op: 'double', value: 1 }).catch(() => undefined)
    expect(worker.sent).toEqual([
      { id: 1, body: { op: 'slow' } },
      { id: 2, body: { op: 'double', value: 1 } },
    ])
    rpc.destroy()
  })

  it('reports a post failure and retires the worker', async () => {
    const worker = new LinkedWorker()
    worker.send = () => {
      throw new Error('DataCloneError')
    }
    const rpc = createWorkerRpc<EchoRequest>({ createWorker: () => worker })

    await expect(rpc.request({ op: 'double', value: 1 })).rejects.toMatchObject({
      message: 'could not post the request to the worker: DataCloneError',
    })
    expect(worker.terminated).toBe(true)
  })
})

describe('worker rpc: server', () => {
  it('ignores messages that are not requests and stops serving when told', async () => {
    const worker = new LinkedWorker()
    const stop = serveWorkerRpc<EchoRequest>(echoHandler, worker.scope)
    const replies: unknown[] = []
    worker.addEventListener('message', (event) => replies.push((event as MessageEvent).data))

    worker.send('not a request')
    worker.send({ id: 1, body: { op: 'double', value: 4 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replies).toEqual([{ id: 1, ok: true, value: 8 }])

    stop()
    worker.send({ id: 2, body: { op: 'double', value: 4 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replies).toHaveLength(1)
  })
})
