import type { createReplSessionInRealm, runJudgeInRealm } from 'src/bootstrap'
import type { JudgeRunResult, WorkerRequest, WorkerResponse } from 'src/types'

// worker-entry.ts reads `self` at module load time, so the worker scope
// shim must be in place before the module is imported, and every test
// needs its own fresh module instance (`replSession` is module-level
// state). `vi.mock` replaces bootstrap for the whole file so judge and
// REPL failures can be forced deterministically instead of depending on
// real parse/policy/import failures.
vi.mock('src/bootstrap', () => ({
  runJudgeInRealm: vi.fn<typeof runJudgeInRealm>(),
  createReplSessionInRealm: vi.fn<typeof createReplSessionInRealm>(),
  serializeError: (error: unknown): { name: string; message: string } => ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  }),
}))

type MessageListener = (event: MessageEvent<WorkerRequest>) => void

interface LoadedWorkerEntry {
  readonly listener: MessageListener
  readonly postMessage: ReturnType<typeof vi.fn>
  readonly runJudgeInRealm: ReturnType<typeof vi.fn>
  readonly createReplSessionInRealm: ReturnType<typeof vi.fn>
}

/**
 * Installs a fresh `self` shim, resets the module registry so `worker-entry`
 * and its mocked `bootstrap` dependency load as new instances (no state or
 * mock call history carried over from a previous test), and returns the
 * listener the module registered plus the doubles it was built from.
 */
async function loadWorkerEntry(): Promise<LoadedWorkerEntry> {
  const postMessage = vi.fn<(message: unknown) => void>()
  const addEventListener = vi.fn<(type: 'message', listener: MessageListener) => void>()
  vi.stubGlobal('self', { postMessage, addEventListener })

  vi.resetModules()
  const bootstrap = await import('src/bootstrap')
  await import('src/worker-entry')

  const registration = addEventListener.mock.calls.find(([type]) => type === 'message')
  if (registration === undefined) {
    throw new Error('worker-entry did not register a message listener')
  }

  return {
    listener: registration[1] as MessageListener,
    postMessage,
    runJudgeInRealm: vi.mocked(bootstrap.runJudgeInRealm),
    createReplSessionInRealm: vi.mocked(bootstrap.createReplSessionInRealm),
  }
}

/** Drains a bounded number of microtask hops, enough for one `.then().catch()` chain to settle. */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

const deliver = (listener: MessageListener, request: WorkerRequest): void => {
  listener({ data: request } as MessageEvent<WorkerRequest>)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('worker-entry: judge path failure', () => {
  it('posts a well-formed failure response carrying the request id when the judge run rejects', async () => {
    const { listener, postMessage, runJudgeInRealm } = await loadWorkerEntry()
    runJudgeInRealm.mockReturnValue(Promise.reject(new Error('judge exploded')))

    deliver(listener, { kind: 'judge', id: 7, code: 'export const s = () => 1', cases: [] })
    await flushMicrotasks()

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({
      kind: 'result',
      id: 7,
      result: expect.objectContaining({
        status: 'error',
        ok: false,
        error: expect.objectContaining({ message: 'judge exploded' }),
      }),
    })
  })
})

describe('worker-entry: unrecognized request kind', () => {
  it('produces a response instead of staying silent', async () => {
    const { listener, postMessage } = await loadWorkerEntry()

    const request = { kind: 'not-a-real-kind', id: 42 } as unknown as WorkerRequest
    deliver(listener, request)

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({
      kind: 'result',
      id: 42,
      result: expect.objectContaining({
        status: 'error',
        ok: false,
        error: expect.objectContaining({
          message: expect.stringContaining("unrecognized request kind 'not-a-real-kind'"),
        }),
      }),
    })
  })
})

describe('worker-entry: postResponse fallback cascade', () => {
  const judgeResult: JudgeRunResult = {
    status: 'fail',
    ok: false,
    cases: [{ name: 'case-1', exportName: 'solve', status: 'fail', actual: 42, expected: 43, durationMs: 1 }],
    console: [],
    dependencies: [],
    durationMs: 5,
  }

  it('falls back to preview serialization when the first postMessage attempt throws', async () => {
    const { listener, postMessage, runJudgeInRealm } = await loadWorkerEntry()
    runJudgeInRealm.mockReturnValue(Promise.resolve(judgeResult))

    let attempt = 0
    const posted: WorkerResponse[] = []
    postMessage.mockImplementation((response: WorkerResponse) => {
      posted.push(response)
      attempt += 1
      if (attempt === 1) {
        throw new Error('DataCloneError: could not clone')
      }
    })

    deliver(listener, { kind: 'judge', id: 1, code: 'export const s = () => 1', cases: [] })
    await flushMicrotasks()

    expect(postMessage).toHaveBeenCalledTimes(2)
    // The raw attempt (1st) carries the untouched result; the retry (2nd)
    // carries the preview, where actual/expected are serialized strings.
    expect(posted[0]).toMatchObject({ result: { cases: [{ actual: 42, expected: 43 }] } })
    expect(posted[1]).toMatchObject({
      kind: 'result',
      id: 1,
      result: { cases: [{ actual: '42', expected: '43' }] },
    })
  })

  it('falls back to the minimal cloneable response when the raw and preview attempts both throw', async () => {
    const { listener, postMessage, runJudgeInRealm } = await loadWorkerEntry()
    runJudgeInRealm.mockReturnValue(Promise.resolve(judgeResult))

    let attempt = 0
    postMessage.mockImplementation(() => {
      attempt += 1
      if (attempt < 3) {
        throw new Error('DataCloneError: could not clone')
      }
    })

    deliver(listener, { kind: 'judge', id: 2, code: 'export const s = () => 1', cases: [] })
    await flushMicrotasks()

    expect(postMessage).toHaveBeenCalledTimes(3)
    expect(postMessage).toHaveBeenNthCalledWith(3, {
      kind: 'result',
      id: 2,
      result: expect.objectContaining({
        status: 'error',
        ok: false,
        error: expect.objectContaining({ message: 'worker response could not be sent to the main thread' }),
      }),
    })
  })
})
