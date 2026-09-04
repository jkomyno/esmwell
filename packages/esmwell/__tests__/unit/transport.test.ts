import { runJudgeInRealm } from 'src/bootstrap'
import { createReplSession, createEsmwell, createTestSession } from 'src/main'
import type { WorkerFactory, WorkerLike } from 'src/main'
import type { SourceTransform } from 'src/transform'
import type { JudgeRunResult, WorkerRequest, WorkerResponse } from 'src/types'
import { vi } from 'vitest'

type Listener = (event: unknown) => void

// Simulates the postMessage clone boundary between the worker and the main
// thread, so a test can prove a value survives structured cloning rather than
// just surviving a plain JS function call.
const cloneAcrossBoundary = <T>(value: T): T => structuredClone(value)

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

class ThrowOnceWorker extends FakeWorker {
  private shouldThrow = true

  override send(message: unknown): void {
    if (this.shouldThrow) {
      this.shouldThrow = false
      throw new Error('DataCloneError: function could not be cloned')
    }
    super.send(message)
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
  transform?: SourceTransform
}

const createSessionWith = (workers: FakeWorker[], options?: SessionOptions) => {
  const factory: WorkerFactory = () => {
    const worker = workers.shift()
    if (worker === undefined) {
      throw new Error('no fake worker left')
    }
    return worker
  }
  return { session: createEsmwell({ workerFactory: factory, ...options }) }
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

describe('session transport: supervisor watchdog', () => {
  it('terminates an unresponsive supervisor after the execution deadline grace period', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const { session } = createSessionWith([worker], { timeoutMs: 30 })

      const pending = session.runJudge('while (true) {}', [])
      await Promise.resolve()
      worker.emitMessage({ kind: 'console', id: 1, chunk: { level: 'log', parts: ['started'] } })
      await vi.advanceTimersByTimeAsync(1029)
      expect(worker.terminated).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      const result = await pending
      expect(result.status).toBe('error')
      expect(result.ok).toBe(false)
      expect(result.error).toMatchObject({ name: 'EsmwellError' })
      expect(result.error?.message).toContain('watchdog grace period')
      expect(result.console).toEqual([{ level: 'log', parts: ['started'] }])
      expect(worker.terminated).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a fresh supervisor after the watchdog fires', async () => {
    vi.useFakeTimers()
    try {
      const hung = new FakeWorker()
      const responsive = new FakeWorker()
      const { session } = createSessionWith([hung, responsive], { timeoutMs: 30 })

      const pendingTimeout = session.runJudge('while (true) {}', [])
      await vi.advanceTimersByTimeAsync(1030)
      const timedOut = await pendingTimeout
      expect(timedOut.error?.name).toBe('EsmwellError')
      expect(hung.terminated).toBe(true)
      expect(responsive.terminated).toBe(false)

      const pending = session.runJudge('export const solve = () => 1', [])
      await Promise.resolve()
      responsive.emitMessage({ kind: 'result', id: 2, result: okResult })
      await expect(pending).resolves.toEqual(okResult)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('session transport: structured error fields', () => {
  it('delivers a policy violation to the caller with its rule and line intact through a session', async () => {
    const inRealm = await runJudgeInRealm('var leaked = 1\nexport const solve = () => leaked', {
      cases: [{ name: 'solve', exportName: 'solve', expected: 1 }],
    })
    expect(inRealm.error).toMatchObject({ name: 'PolicyViolation', rule: 'var', line: 1 })

    const worker = new FakeWorker()
    const { session } = createSessionWith([worker])

    const pending = session.runJudge('var leaked = 1\nexport const solve = () => leaked', [
      { name: 'solve', exportName: 'solve', expected: 1 },
    ])
    await Promise.resolve()
    worker.emitMessage({ kind: 'result', id: 1, result: cloneAcrossBoundary(inRealm) })

    const result = await pending
    expect(result.error).toMatchObject({ name: 'PolicyViolation', rule: 'var', line: 1 })
  })

  it('delivers a resolution failure to the caller with its kind and specifier intact through a session', async () => {
    const inRealm = await runJudgeInRealm(`import _ from 'lodash-es'\nexport const solve = () => 1`, {
      cases: [{ name: 'solve', exportName: 'solve', expected: 1 }],
      autoInstall: false,
    })
    expect(inRealm.error).toMatchObject({
      name: 'SpecifierResolutionError',
      kind: 'undeclared',
      specifier: 'lodash-es',
    })

    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { autoInstall: false })

    const pending = session.runJudge(`import _ from 'lodash-es'\nexport const solve = () => 1`, [
      { name: 'solve', exportName: 'solve', expected: 1 },
    ])
    await Promise.resolve()
    worker.emitMessage({ kind: 'result', id: 1, result: cloneAcrossBoundary(inRealm) })

    const result = await pending
    expect(result.error).toMatchObject({ name: 'SpecifierResolutionError', kind: 'undeclared', specifier: 'lodash-es' })
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

  it('settles a synchronous send failure and keeps the worker reusable', async () => {
    vi.useFakeTimers()
    try {
      const worker = new ThrowOnceWorker()
      const { session } = createSessionWith([worker], { timeoutMs: 20 })

      const failed = await session.runJudge('code', [])
      expect(failed).toMatchObject({
        status: 'error',
        error: { name: 'EsmwellError', message: expect.stringContaining('could not send the request') },
      })

      await vi.advanceTimersByTimeAsync(20)
      expect(worker.terminated).toBe(false)

      const recovered = session.runJudge('export const solve = () => 1', [])
      await Promise.resolve()
      expect(worker.sent).toHaveLength(1)
      worker.emitMessage({ kind: 'result', id: worker.sent[0]!.id, result: okResult })

      await expect(recovered).resolves.toEqual(okResult)
      expect(worker.terminated).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('test-session transport timeout', () => {
  it('uses a 60-second default through createTestSession', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', new URL('https://example.test/assets/'))
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn<() => Promise<ServiceWorkerRegistration | undefined>>(() => Promise.resolve(undefined)),
        register: vi.fn<() => Promise<ServiceWorkerRegistration>>(() =>
          Promise.resolve({
            active: {},
            scope: 'https://example.test/assets/',
          } as ServiceWorkerRegistration),
        ),
      },
    })
    vi.stubGlobal('caches', {
      delete: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
      has: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
    })

    try {
      const worker = new FakeWorker()
      const workerFactory: WorkerFactory = () => worker
      const session = createTestSession({
        serviceWorkerUrl: 'https://example.test/assets/module-service-worker.mjs',
        workerUrl: 'https://example.test/assets/test-worker-entry.mjs',
        workerFactory,
      })

      let settled = false
      const pending = session
        .run({ engine: 'vitest', modules: { 'tests/a.test': '' }, testFiles: ['tests/a.test'] })
        .then((result) => {
          settled = true
          return result
        })

      await vi.advanceTimersByTimeAsync(0)
      expect(worker.sent).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(settled).toBe(false)
      expect(worker.terminated).toBe(false)

      await vi.advanceTimersByTimeAsync(54_999)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toMatchObject({
        status: 'error',
        error: { name: 'TimeoutError', message: expect.stringContaining('60000ms') },
      })
      expect(worker.terminated).toBe(true)
      session.close()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('includes service-worker registration in the configured deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', new URL('https://example.test/assets/'))
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn<() => Promise<ServiceWorkerRegistration | undefined>>(() => Promise.resolve(undefined)),
        register: vi.fn<() => Promise<ServiceWorkerRegistration>>(() => new Promise(() => {})),
      },
    })
    vi.stubGlobal('caches', {
      delete: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
      has: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
    })

    try {
      const workerFactory = vi.fn<WorkerFactory>()
      const session = createTestSession({
        serviceWorkerUrl: 'https://example.test/assets/module-service-worker.mjs',
        workerUrl: 'https://example.test/assets/test-worker-entry.mjs',
        workerFactory,
        timeoutMs: 50,
      })
      const pending = session.run({
        engine: 'vitest',
        modules: { 'tests/a.test': '' },
        testFiles: ['tests/a.test'],
      })

      await vi.advanceTimersByTimeAsync(49)
      expect(workerFactory).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      await expect(pending).resolves.toMatchObject({
        status: 'error',
        error: { name: 'TimeoutError', message: expect.stringContaining('50ms') },
      })
      expect(workerFactory).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('gives the worker only the budget left after service-worker setup', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', new URL('https://example.test/assets/'))
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn<() => Promise<ServiceWorkerRegistration>>(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    active: {},
                    scope: 'https://example.test/assets/',
                  } as ServiceWorkerRegistration),
                400,
              )
            }),
        ),
      },
    })
    vi.stubGlobal('caches', {
      delete: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
      has: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
    })

    try {
      const worker = new FakeWorker()
      const session = createTestSession({
        serviceWorkerUrl: 'https://example.test/assets/module-service-worker.mjs',
        workerUrl: 'https://example.test/assets/test-worker-entry.mjs',
        workerFactory: () => worker,
        timeoutMs: 1_000,
      })

      let settled = false
      const pending = session
        .run({ engine: 'vitest', modules: { 'tests/a.test': '' }, testFiles: ['tests/a.test'] })
        .then((result) => {
          settled = true
          return result
        })

      await vi.advanceTimersByTimeAsync(400)
      expect(worker.sent).toHaveLength(1)

      // Setup spent 400ms of the 1000ms budget, so the worker gets the
      // remaining 600ms. A fresh full timeout would settle at 1400ms instead.
      await vi.advanceTimersByTimeAsync(599)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toMatchObject({
        status: 'error',
        error: { name: 'TimeoutError' },
      })
      expect(worker.terminated).toBe(true)
      session.close()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
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

  it('reports an unresponsive supervisor distinctly from an execution timeout', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const { session } = createSessionWith([worker], { timeoutMs: 20 })
      const pending = session.runJudge('while (true) {}', [])
      await vi.advanceTimersByTimeAsync(1020)
      const result = await pending
      expect(result.error).toMatchObject({ name: 'EsmwellError' })
      expect(result.error?.message).toContain('supervisor')
      expect(worker.terminated).toBe(true)
    } finally {
      vi.useRealTimers()
    }
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

  it('recovers with a fresh supervisor when the watchdog fires', async () => {
    vi.useFakeTimers()
    try {
      const hung = new FakeWorker()
      const responsive = new FakeWorker()
      const session = createReplSessionForTests([hung, responsive], { timeoutMs: 30 })

      const pendingTimeout = session.evaluate('while (true) {}')
      await vi.advanceTimersByTimeAsync(1030)
      const timedOut = await pendingTimeout
      expect(timedOut.ok).toBe(false)
      expect(timedOut.error).toMatchObject({ name: 'EsmwellError' })
      expect(hung.terminated).toBe(true)

      const pending = session.evaluate('1 + 1')
      await Promise.resolve()
      responsive.emitMessage({ kind: 'repl-result', id: 2, result: { ...okReplResult, value: 2 } })
      await expect(pending).resolves.toMatchObject({ ok: true, value: 2 })
    } finally {
      vi.useRealTimers()
    }
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

function createReplSessionForTests(workers: FakeWorker[], options?: SessionOptions) {
  const factory: WorkerFactory = () => {
    const worker = workers.shift()
    if (worker === undefined) {
      throw new Error('no fake worker left')
    }
    return worker
  }
  return createReplSession({ workerFactory: factory, ...options })
}

// Transforms run inside the session queue, so a settled request needs a few
// microtask turns before the worker sees it.
const flushMicrotasks = async (turns = 8): Promise<void> => {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve()
  }
}

const throwingTransform: SourceTransform = () => {
  throw Object.assign(new SyntaxError("TS1005: ',' expected."), { name: 'TypeScriptError', line: 3, column: 7 })
}

const compileOrBoom: SourceTransform = async (source) => {
  if (source.includes('boom')) throw new Error('cannot compile')
  return source
}

describe('session transport: transform', () => {
  const okReplResult = { ok: true, console: [], dependencies: [], durationMs: 1 }

  it('posts the transformed judge module and tells the transform which entry point it serves', async () => {
    const worker = new FakeWorker()
    const contexts: unknown[] = []
    const transform: SourceTransform = (source, context) => {
      contexts.push(context)
      return source.replace(': number', '')
    }
    const { session } = createSessionWith([worker], { transform })

    const pending = session.runJudge('export const solve = (n: number) => n', [])
    await flushMicrotasks()

    expect(contexts).toEqual([{ kind: 'judge' }])
    expect(worker.sent[0]).toMatchObject({ kind: 'judge', code: 'export const solve = (n) => n' })
    worker.emitMessage({ kind: 'result', id: 1, result: okResult })
    await expect(pending).resolves.toEqual(okResult)
  })

  it('awaits an asynchronous transform and keeps REPL inputs in submission order', async () => {
    const worker = new FakeWorker()
    const gates = new Map<string, () => void>()
    const transform: SourceTransform = (source) =>
      new Promise<string>((resolve) => {
        gates.set(source, () => resolve(`${source} /* compiled */`))
      })
    const session = createReplSessionForTests([worker], { transform })

    const first = session.evaluate('first')
    const second = session.evaluate('second')
    await flushMicrotasks()
    expect(worker.sent).toHaveLength(0)

    // Only the head of the queue is being transformed; the second input waits its turn.
    expect([...gates.keys()]).toEqual(['first'])
    gates.get('first')?.()
    await flushMicrotasks()
    expect(worker.sent[0]).toMatchObject({ kind: 'repl-input', id: 1, input: 'first /* compiled */' })
    worker.emitMessage({ kind: 'repl-result', id: 1, result: okReplResult })
    await first

    await flushMicrotasks()
    gates.get('second')?.()
    await flushMicrotasks()
    expect(worker.sent[1]).toMatchObject({ kind: 'repl-input', id: 2, input: 'second /* compiled */' })
    worker.emitMessage({ kind: 'repl-result', id: 2, result: okReplResult })
    await expect(second).resolves.toMatchObject({ ok: true })
  })

  it('turns a transform failure into an error result that keeps the diagnostic position', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { transform: throwingTransform })

    const result = await session.runJudge('const broken: = 1', [])

    expect(worker.sent).toHaveLength(0)
    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      name: 'TypeScriptError',
      message: "TS1005: ',' expected.",
      line: 3,
      column: 7,
    })
    expect(result.cases).toEqual([])
  })

  it('reports a REPL transform failure without touching the persistent scope', async () => {
    const worker = new FakeWorker()
    const session = createReplSessionForTests([worker], { transform: compileOrBoom })

    const failed = await session.evaluate('boom')
    expect(failed).toMatchObject({ ok: false, error: { name: 'Error', message: 'cannot compile' } })
    expect(worker.sent).toHaveLength(0)

    const next = session.evaluate('1 + 1')
    await flushMicrotasks()
    expect(worker.sent[0]).toMatchObject({ kind: 'repl-input', id: 1, input: '1 + 1' })
    worker.emitMessage({ kind: 'repl-result', id: 1, result: { ...okReplResult, value: 2 } })
    await expect(next).resolves.toMatchObject({ ok: true, value: 2 })
  })

  it('rejects a transform that does not return a string', async () => {
    const worker = new FakeWorker()
    const { session } = createSessionWith([worker], { transform: (() => 42) as unknown as SourceTransform })

    const result = await session.runJudge('export const solve = () => 1', [])

    expect(result.error).toMatchObject({
      name: 'TypeError',
      message: 'transform must return a string, received number',
    })
  })

  it('transforms every module of a test run at once and posts them by id', async () => {
    vi.stubGlobal('location', new URL('https://example.test/assets/'))
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn<() => Promise<ServiceWorkerRegistration>>(() =>
          Promise.resolve({ active: {}, scope: 'https://example.test/assets/' } as ServiceWorkerRegistration),
        ),
      },
    })
    vi.stubGlobal('caches', {
      delete: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
      has: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
    })

    try {
      const worker = new FakeWorker()
      const gates = new Map<string, () => void>()
      const contexts: unknown[] = []
      const transform: SourceTransform = (source, context) =>
        new Promise<string>((resolve) => {
          contexts.push(context)
          gates.set(source, () => resolve(`${source} /* compiled */`))
        })
      const session = createTestSession({
        serviceWorkerUrl: 'https://example.test/assets/module-service-worker.mjs',
        workerUrl: 'https://example.test/assets/test-worker-entry.mjs',
        workerFactory: () => worker,
        transform,
      })

      const pending = session.run({
        engine: 'vitest',
        modules: { 'src/add': 'export const add = 1', 'tests/add.test': 'import "../src/add"' },
        testFiles: ['tests/add.test'],
      })
      await flushMicrotasks()

      // Neither module waits for the other: both transforms are in flight before any settles.
      expect([...gates.keys()]).toEqual(['export const add = 1', 'import "../src/add"'])
      expect(contexts).toEqual([
        { kind: 'test', id: 'src/add' },
        { kind: 'test', id: 'tests/add.test' },
      ])
      expect(worker.sent).toHaveLength(0)

      for (const release of [...gates.values()].toReversed()) release()
      await flushMicrotasks(32)
      expect(worker.sent[0]).toMatchObject({
        kind: 'test',
        run: {
          modules: {
            'src/add': 'export const add = 1 /* compiled */',
            'tests/add.test': 'import "../src/add" /* compiled */',
          },
        },
      })
      const okTestResult = { status: 'passed', ok: true, tests: [], console: [], dependencies: [], durationMs: 1 }
      worker.emitMessage({ kind: 'test-result', id: 1, result: okTestResult } as WorkerResponse)
      await expect(pending).resolves.toMatchObject({ ok: true })
      session.close()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
