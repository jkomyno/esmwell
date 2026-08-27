import { createRunesm } from 'src/main'
import type { WorkerFactory, WorkerLike } from 'src/main'
import type { JudgeRunResult, WorkerRequest, WorkerResponse } from 'src/types'

type Listener = (event: unknown) => void

class FakeWorker implements WorkerLike {
  readonly sent: WorkerRequest[] = []
  terminated = false
  private readonly listeners = new Map<string, Set<Listener>>()

  send(message: unknown): void {
    this.sent.push(message as WorkerRequest)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type)
    if (existing === undefined) {
      this.listeners.set(type, new Set([listener]))
    } else {
      existing.add(listener)
    }
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emitMessage(response: WorkerResponse): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: response } as MessageEvent<WorkerResponse>)
    }
  }

  emitError(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) {
      listener({ message } as ErrorEvent)
    }
  }
}

const okResult: JudgeRunResult = {
  status: 'pass',
  ok: true,
  cases: [],
  console: [],
  dependencies: [],
  durationMs: 1,
}

interface SessionOptions {
  deps?: Record<string, string>
  autoInstall?: boolean
  timeoutMs?: number
}

const createSessionWith = (workers: FakeWorker[], options?: SessionOptions) => {
  const factory: WorkerFactory = () => {
    const worker = workers.shift()
    if (worker === undefined) {
      throw new Error('no fake worker left')
    }
    return worker
  }
  return { session: createRunesm({ workerFactory: factory, ...options }) }
}

describe('session transport: request/response pairing', () => {
  it('forwards the judge request with options and resolves the matching result', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { deps: { 'pkg-a': '1.0.0' }, autoInstall: false })

    const pending = session.runJudge('export const solve = () => 1', [{ name: 's', exportName: 'solve', expected: 1 }])
    await Promise.resolve()

    expect(worker.sent).toHaveLength(1)
    expect(worker.sent[0]).toMatchObject({
      kind: 'judge',
      id: 1,
      code: 'export const solve = () => 1',
      cases: [{ name: 's', exportName: 'solve', expected: 1 }],
      deps: { 'pkg-a': '1.0.0' },
      autoInstall: false,
    })

    worker.emitMessage({ kind: 'result', id: 1, result: okResult })
    await expect(pending).resolves.toEqual(okResult)
  })

  it('ignores responses with stale ids', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    const pending = session.runJudge('code', [])
    await Promise.resolve()

    worker.emitMessage({ kind: 'result', id: 99, result: okResult })
    worker.emitMessage({ kind: 'result', id: 1, result: okResult })
    await expect(pending).resolves.toEqual(okResult)
  })

  it('increments request ids across serialized runs', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    const first = session.runJudge('a', [])
    await Promise.resolve()
    worker.emitMessage({ kind: 'result', id: 1, result: okResult })
    await first

    const second = session.runJudge('b', [])
    await Promise.resolve()
    expect(worker.sent.map((request) => request.id)).toEqual([1, 2])
    worker.emitMessage({ kind: 'result', id: 2, result: okResult })
    await second
  })

  it('omits unset options from the request payload', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    void session.runJudge('code', [])
    await Promise.resolve()
    expect(worker.sent[0]).not.toHaveProperty('deps')
    expect(worker.sent[0]).not.toHaveProperty('autoInstall')
  })
})

describe('session transport: console streaming', () => {
  it('streams chunks in order before the result and mirrors them in the result', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    const chunks: string[] = []
    const pending = session.runJudge('code', [], {
      onConsoleChunk: (chunk) => {
        chunks.push(chunk.parts.join(' '))
      },
    })
    await Promise.resolve()

    const streamedChunk = { level: 'log' as const, parts: ['first'] }
    const secondChunk = { level: 'warn' as const, parts: ['second'] }
    worker.emitMessage({ kind: 'console', id: 1, chunk: streamedChunk })
    worker.emitMessage({ kind: 'console', id: 1, chunk: secondChunk })
    worker.emitMessage({
      kind: 'result',
      id: 1,
      result: { ...okResult, console: [streamedChunk, secondChunk] },
    })

    const result = await pending
    expect(chunks).toEqual(['first', 'second'])
    expect(result.console).toEqual([streamedChunk, secondChunk])
  })
})

describe('session transport: hard timeout', () => {
  it('terminates the worker and resolves a TLE result with streamed console', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { timeoutMs: 30 })

    const pending = session.runJudge('while (true) {}', [])
    await Promise.resolve()
    worker.emitMessage({ kind: 'console', id: 1, chunk: { level: 'log', parts: ['started'] } })

    const result = await pending
    expect(result.status).toBe('error')
    expect(result.ok).toBe(false)
    expect(result.error).toMatchObject({ name: 'TimeoutError' })
    expect(result.error?.message).toContain('terminated')
    expect(result.console).toEqual([{ level: 'log', parts: ['started'] }])
    expect(worker.terminated).toBe(true)
  })

  it('starts a fresh worker for the next run after a timeout', async () => {
    const hung = new FakeWorker()
    const responsive = new FakeWorker()
    const { session } = createSessionWith([hung, responsive], { timeoutMs: 30 })

    const timedOut = await session.runJudge('while (true) {}', [])
    expect(timedOut.error?.name).toBe('TimeoutError')
    expect(hung.terminated).toBe(true)
    expect(responsive.terminated).toBe(false)

    const pending = session.runJudge('export const solve = () => 1', [])
    await Promise.resolve()
    responsive.emitMessage({ kind: 'result', id: 2, result: okResult })
    await expect(pending).resolves.toEqual(okResult)
  })
})

describe('session transport: worker errors', () => {
  it('reports load failures and terminates', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    const pending = session.runJudge('code', [])
    await Promise.resolve()
    worker.emitError('Failed to fetch worker script')

    const result = await pending
    expect(result.status).toBe('error')
    expect(result.error?.message).toContain('Failed to fetch worker script')
    expect(worker.terminated).toBe(true)
  })
})

describe('session transport: lifecycle', () => {
  it('closes the session and rejects further runs', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    const first = session.runJudge('code', [])
    await Promise.resolve()
    worker.emitMessage({ kind: 'result', id: 1, result: okResult })
    await first

    session.close()
    expect(worker.terminated).toBe(true)
    await expect(session.runJudge('code', [])).rejects.toThrow('session is closed')
  })

  it('reuses one worker across successful runs', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    const first = session.runJudge('a', [])
    await Promise.resolve()
    worker.emitMessage({ kind: 'result', id: 1, result: okResult })
    await first

    const second = session.runJudge('b', [])
    await Promise.resolve()
    worker.emitMessage({ kind: 'result', id: 2, result: okResult })
    await second

    expect(worker.terminated).toBe(false)
  })
})
