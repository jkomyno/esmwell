import { createWorkerSupervisor } from 'src/supervisor'
import type { ExecutionWorkerLike, SupervisedRequestKind } from 'src/supervisor'
import type { JudgeRunResult, ReplResult, WorkerRequest, WorkerResponse } from 'src/types'

type Listener = (event: unknown) => void

class FakeExecutionWorker implements ExecutionWorkerLike {
  readonly sent: WorkerRequest[] = []
  terminated = false
  throwOnPost = false
  private readonly listeners = new Map<string, Set<Listener>>()

  send(message: unknown): void {
    if (this.throwOnPost) {
      throw new Error('message could not be cloned')
    }
    this.sent.push(message as WorkerRequest)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
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

const judgeResult: JudgeRunResult = {
  status: 'pass',
  ok: true,
  cases: [],
  console: [],
  dependencies: [],
  durationMs: 1,
}

const replResult: ReplResult = {
  ok: true,
  value: 1,
  console: [],
  dependencies: [],
  durationMs: 1,
}

const judgeRequest = (id: number): WorkerRequest => ({
  kind: 'judge',
  id,
  code: 'export const solve = () => 1',
  cases: [],
  timeoutMs: 100,
  executionWorkerUrl: 'https://example.test/execution-worker-entry.mjs',
})

const replRequest = (id: number, input: string): WorkerRequest => ({
  kind: 'repl-input',
  id,
  input,
  timeoutMs: 100,
  executionWorkerUrl: 'https://example.test/execution-worker-entry.mjs',
})

const createHarness = (allowedRequestKinds: readonly SupervisedRequestKind[]) => {
  const workers: FakeExecutionWorker[] = []
  const responses: WorkerResponse[] = []
  const supervisor = createWorkerSupervisor({
    host: { send: (response) => responses.push(response as WorkerResponse) },
    createWorker: () => {
      const worker = new FakeExecutionWorker()
      workers.push(worker)
      return worker
    },
    defaultExecutionWorkerUrl: 'https://example.test/default-execution-worker.mjs',
    allowedRequestKinds: new Set(allowedRequestKinds),
  })
  return { responses, supervisor, workers }
}

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://example.test/'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('execution supervisor', () => {
  it('uses and terminates a fresh child for every judge run', () => {
    const { responses, supervisor, workers } = createHarness(['judge'])

    supervisor.handle(judgeRequest(1))
    workers[0]!.emitMessage({ kind: 'result', id: 1, result: judgeResult })
    supervisor.handle(judgeRequest(2))
    workers[1]!.emitMessage({ kind: 'result', id: 2, result: judgeResult })

    expect(workers).toHaveLength(2)
    expect(workers.every((worker) => worker.terminated)).toBe(true)
    expect(responses.filter((response) => response.kind === 'result')).toHaveLength(2)
  })

  it('terminates a timed-out child and keeps the supervisor reusable', () => {
    vi.useFakeTimers()
    const { responses, supervisor, workers } = createHarness(['judge'])

    supervisor.handle(judgeRequest(1))
    vi.advanceTimersByTime(100)

    expect(workers[0]!.terminated).toBe(true)
    expect(responses.at(-1)).toMatchObject({
      kind: 'result',
      id: 1,
      result: { status: 'error', error: { name: 'TimeoutError' } },
    })

    supervisor.handle(judgeRequest(2))
    workers[1]!.emitMessage({ kind: 'result', id: 2, result: judgeResult })
    expect(responses.at(-1)).toMatchObject({ kind: 'result', id: 2, result: { ok: true } })
  })

  it('reuses one REPL child until reset destroys its realm', () => {
    const { responses, supervisor, workers } = createHarness(['repl-input', 'repl-reset'])

    supervisor.handle(replRequest(1, 'let count = 1'))
    workers[0]!.emitMessage({ kind: 'repl-result', id: 1, result: replResult })
    supervisor.handle(replRequest(2, 'count'))
    workers[0]!.emitMessage({ kind: 'repl-result', id: 2, result: replResult })

    expect(workers).toHaveLength(1)
    expect(workers[0]!.terminated).toBe(false)

    supervisor.handle({ kind: 'repl-reset', id: 3 })
    expect(workers[0]!.terminated).toBe(true)
    expect(responses.at(-1)).toEqual({ kind: 'repl-ack', id: 3 })

    supervisor.handle(replRequest(4, 'count'))
    expect(workers).toHaveLength(2)
  })

  it('ignores late child messages after the request settled', () => {
    const { responses, supervisor, workers } = createHarness(['judge'])
    supervisor.handle(judgeRequest(1))
    workers[0]!.emitMessage({ kind: 'result', id: 1, result: judgeResult })
    workers[0]!.emitMessage({ kind: 'console', id: 1, chunk: { level: 'log', parts: ['late'] } })
    expect(responses).toHaveLength(1)
  })

  it('terminates a failed child and returns a typed error', () => {
    const { responses, supervisor, workers } = createHarness(['judge'])
    supervisor.handle(judgeRequest(1))
    workers[0]!.emitError('child crashed')
    expect(workers[0]!.terminated).toBe(true)
    expect(responses.at(-1)).toMatchObject({
      kind: 'result',
      result: { error: { name: 'EsmwellError', message: 'child crashed' } },
    })
  })

  it('reports child creation failures without crashing the coordinator', () => {
    const responses: WorkerResponse[] = []
    const supervisor = createWorkerSupervisor({
      host: { send: (response) => responses.push(response as WorkerResponse) },
      createWorker: () => {
        throw new Error('worker blocked by policy')
      },
      defaultExecutionWorkerUrl: 'https://example.test/default-execution-worker.mjs',
      allowedRequestKinds: new Set(['judge']),
    })

    expect(() => supervisor.handle(judgeRequest(1))).not.toThrow()
    expect(responses.at(-1)).toMatchObject({
      kind: 'result',
      result: {
        error: { name: 'EsmwellError', message: 'could not start the execution worker: worker blocked by policy' },
      },
    })
  })

  it('discards a persistent child when posting a REPL request fails', () => {
    const { responses, supervisor, workers } = createHarness(['repl-input'])
    supervisor.handle(replRequest(1, 'let count = 1'))
    workers[0]!.emitMessage({ kind: 'repl-result', id: 1, result: replResult })
    workers[0]!.throwOnPost = true

    supervisor.handle(replRequest(2, 'count'))

    expect(workers[0]!.terminated).toBe(true)
    expect(responses.at(-1)).toMatchObject({
      kind: 'repl-result',
      result: {
        error: {
          name: 'EsmwellError',
          message: 'could not send the request to the execution worker: message could not be cloned',
        },
      },
    })

    supervisor.handle(replRequest(3, 'count'))
    expect(workers).toHaveLength(2)
  })
})
