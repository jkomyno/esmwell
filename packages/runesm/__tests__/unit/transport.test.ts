import { createReplSession, createRunesm } from 'src/main'
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

  emitMessageError(): void {
    for (const listener of this.listeners.get('messageerror') ?? []) {
      listener({} as MessageEvent)
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

  it('settles an in-flight run within a tick when closed, not after the timeout', async () => {
    const worker = new FakeWorker()
    // A generous timeout makes a timeout-based settle unmistakable: if the
    // assertions below observe a settled promise before this elapses, the
    // settle did not come from the timer.
    const { session } = createSessionWith([worker], { timeoutMs: 10_000 })

    const pending = session.runJudge('while (true) {}', [])
    await Promise.resolve()

    session.close()

    const result = await pending
    expect(result.status).toBe('error')
    expect(result.error?.name).not.toBe('TimeoutError')
    expect(result.error?.message).toContain('closed')
    expect(worker.terminated).toBe(true)
  })

  it('settles an in-flight run promptly on messageerror, with its own distinct message', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { timeoutMs: 10_000 })

    const pending = session.runJudge('code', [])
    await Promise.resolve()

    worker.emitMessageError()

    const result = await pending
    expect(result.status).toBe('error')
    expect(result.error?.name).not.toBe('TimeoutError')
    expect(result.error?.message).toContain('messageerror')
    expect(result.error?.message).not.toContain('closed')
    expect(worker.terminated).toBe(true)
  })

  it('still produces a TimeoutError and terminates the worker on an actual timeout', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { timeoutMs: 20 })

    const result = await session.runJudge('while (true) {}', [])
    expect(result.error).toMatchObject({ name: 'TimeoutError' })
    expect(worker.terminated).toBe(true)
  })

  it('keeps a single settle when a result and the timeout land in the same tick', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { timeoutMs: 10 })

    const pending = session.runJudge('code', [])
    await Promise.resolve()

    // Both a legitimate result and the timeout firing "at once": whichever
    // wins, the settled flag must stop the other from double-settling.
    worker.emitMessage({ kind: 'result', id: 1, result: okResult })
    await new Promise((resolve) => setTimeout(resolve, 30))

    const result = await pending
    expect(result).toEqual(okResult)
  })

  it('settles a request with an unrecognized response kind instead of hanging', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { timeoutMs: 10_000 })

    const pending = session.runJudge('code', [])
    await Promise.resolve()

    // Simulates version skew: a response kind this build's transport does
    // not treat as this request's resultKind.
    worker.emitMessage({ kind: 'repl-ack', id: 1 } as unknown as WorkerResponse)

    const result = await pending
    expect(result.status).toBe('error')
    expect(result.error?.name).not.toBe('TimeoutError')
    expect(result.error?.message).toContain('repl-ack')
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

describe('session transport: repl', () => {
  const okReplResult = {
    ok: true,
    console: [],
    dependencies: [],
    durationMs: 1,
  }

  it('pairs repl inputs with results and streams console', async () => {
    const worker = new FakeWorker()
    const session = createReplSessionForTests([worker])

    const chunks: string[] = []
    const pending = session.evaluate('let n = 1', {
      onConsoleChunk: (chunk) => {
        chunks.push(chunk.parts.join(' '))
      },
    })
    await Promise.resolve()

    expect(worker.sent[0]).toMatchObject({ kind: 'repl-input', id: 1, input: 'let n = 1' })
    worker.emitMessage({ kind: 'console', id: 1, chunk: { level: 'log', parts: ['declared'] } })
    worker.emitMessage({ kind: 'repl-result', id: 1, result: { ...okReplResult, value: 1 } })

    const result = await pending
    expect(result.value).toBe(1)
    expect(chunks).toEqual(['declared'])
  })

  it('forwards session options on repl inputs', async () => {
    const worker = new FakeWorker()
    const session = createReplSessionForTests([worker], { deps: { pkg: '1.0.0' }, autoInstall: false })

    void session.evaluate('x').catch(() => undefined)
    await Promise.resolve()
    expect(worker.sent[0]).toMatchObject({ deps: { pkg: '1.0.0' }, autoInstall: false })
  })

  it('resolves reset once acknowledged', async () => {
    const worker = new FakeWorker()
    const session = createReplSessionForTests([worker])

    let settled = false
    const pending = session.reset().then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(worker.sent[0]).toMatchObject({ kind: 'repl-reset', id: 1 })
    expect(settled).toBe(false)
    worker.emitMessage({ kind: 'repl-ack', id: 1 })
    await pending
    expect(settled).toBe(true)
  })

  it('times out hung evaluations with a TLE result and recovers', async () => {
    const hung = new FakeWorker()
    const responsive = new FakeWorker()
    const session = createReplSessionForTests([hung, responsive], { timeoutMs: 30 })

    const timedOut = await session.evaluate('while (true) {}')
    expect(timedOut.ok).toBe(false)
    expect(timedOut.error).toMatchObject({ name: 'TimeoutError' })
    expect(hung.terminated).toBe(true)

    const pending = session.evaluate('1 + 1')
    await Promise.resolve()
    responsive.emitMessage({ kind: 'repl-result', id: 2, result: { ...okReplResult, value: 2 } })
    await expect(pending).resolves.toMatchObject({ ok: true, value: 2 })
  })

  it('rejects evaluations after close', async () => {
    const worker = new FakeWorker()
    const session = createReplSessionForTests([worker])

    const first = session.evaluate('x')
    await Promise.resolve()
    worker.emitMessage({ kind: 'repl-result', id: 1, result: okReplResult })
    await first

    session.close()
    await expect(session.evaluate('x')).rejects.toThrow('session is closed')
  })
})

function createReplSessionForTests(
  workers: FakeWorker[],
  options?: { deps?: Record<string, string>; autoInstall?: boolean; timeoutMs?: number },
) {
  const factory: WorkerFactory = () => {
    const worker = workers.shift()
    if (worker === undefined) {
      throw new Error('no fake worker left')
    }
    return worker
  }
  return createReplSession({ workerFactory: factory, ...options })
}
