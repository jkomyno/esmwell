import { createModuleProjectSession, createTestSession } from 'src/index'
import type { EsmwellOptions, ModuleProjectSessionOptions } from 'src/main'
import type { ModuleProjectResult } from 'src/module-project'
import type { WorkerFactory, WorkerLike } from 'src/main'
import type { WorkerResponse } from 'src/types'

type Listener = (event: unknown) => void

class FakeWorker implements WorkerLike {
  readonly sent: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, Set<Listener>>()

  send(message: unknown): void {
    this.sent.push(message)
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
}

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 32; index += 1) await Promise.resolve()
}

const okProjectResult: ModuleProjectResult = {
  status: 'pass',
  ok: true,
  exports: { answer: 42 },
  console: [],
  dependencies: [],
  durationMs: 1,
}

describe('module-project session transport', () => {
  beforeEach(() => {
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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('transforms and forwards a project, then terminates its fresh worker and deletes its graph', async () => {
    const workers = [new FakeWorker(), new FakeWorker()] as const
    const workerFactory: WorkerFactory = () => {
      const worker = workers.find((candidate) => candidate.sent.length === 0 && !candidate.terminated)
      if (worker === undefined) throw new Error('no fake worker available')
      return worker
    }
    const contexts: unknown[] = []
    const session = createModuleProjectSession({
      workerUrl: 'https://example.test/assets/project-worker-entry.mjs',
      serviceWorkerUrl: 'https://example.test/assets/module-service-worker.mjs',
      workerFactory,
      deps: { pkg: '1.0.0' },
      autoInstall: false,
      transform: (source, context) => {
        contexts.push(context)
        return `${source} /* transformed */`
      },
    })

    const first = session.run({
      modules: { 'src/main': `import './value'`, 'src/value': `export const value = 1` },
      entry: 'src/main',
    })
    await flushMicrotasks()

    expect(contexts).toEqual([
      { kind: 'project', id: 'src/main' },
      { kind: 'project', id: 'src/value' },
    ])
    expect(workers[0].sent[0]).toMatchObject({
      kind: 'module-project',
      project: {
        entry: 'src/main',
        modules: {
          'src/main': `import './value' /* transformed */`,
          'src/value': `export const value = 1 /* transformed */`,
        },
      },
      deps: { pkg: '1.0.0' },
      autoInstall: false,
    })

    vi.mocked(caches.has).mockResolvedValueOnce(true).mockResolvedValue(false)
    workers[0].emitMessage({ kind: 'module-project-result', id: 1, result: okProjectResult })
    await expect(first).resolves.toEqual(okProjectResult)
    expect(workers[0].terminated).toBe(true)
    expect(caches.delete).toHaveBeenCalledWith(expect.stringMatching(/^esmwell:test-graph:v1:/))
    expect(caches.delete).toHaveBeenCalledTimes(2)
    expect(caches.has).toHaveBeenCalledWith(expect.stringMatching(/^esmwell:test-graph:v1:/))

    const second = session.run({ modules: { main: `export const answer = 42` }, entry: 'main' })
    await flushMicrotasks()
    expect(workers[1].sent).toHaveLength(1)
    workers[1].emitMessage({ kind: 'module-project-result', id: 1, result: okProjectResult })
    await expect(second).resolves.toEqual(okProjectResult)
    expect(workers[1].terminated).toBe(true)
  })

  describe.each(['project', 'test'] as const)('%s session closure', (kind) => {
    const create = (options: ModuleProjectSessionOptions & EsmwellOptions) => {
      options = { serviceWorkerUrl: 'https://example.test/assets/module-service-worker.mjs', ...options }
      const modules = { main: 'await new Promise(() => {})' }
      if (kind === 'project') {
        const session = createModuleProjectSession(options)
        return { close: session.close, run: () => session.run({ modules, entry: 'main' }) }
      }
      const session = createTestSession(options)
      return { close: session.close, run: () => session.run({ engine: 'vitest', modules, testFiles: ['main'] }) }
    }

    it('terminates every active worker and settles runs with graph cleanup', async () => {
      const workers: FakeWorker[] = []
      const session = create({
        workerUrl: 'https://example.test/assets/worker.mjs',
        workerFactory: () => {
          const worker = new FakeWorker()
          workers.push(worker)
          return worker
        },
      })
      const runs = [session.run(), session.run()]
      await flushMicrotasks()
      expect(workers).toHaveLength(2)
      session.close()
      session.close()
      expect(workers.every((worker) => worker.terminated)).toBe(true)
      for (const run of runs) {
        await expect(run).resolves.toMatchObject({
          status: 'error',
          error: { message: expect.stringContaining('closed') },
        })
      }
      expect(caches.delete).toHaveBeenCalledTimes(2)
      await expect(session.run()).rejects.toThrow('closed')
    })

    it.each(['transform', 'registration'] as const)(
      'settles during pending %s without creating a late worker',
      async (stage) => {
        const pending = Promise.withResolvers<string>()
        const workerFactory = vi.fn<WorkerFactory>(() => new FakeWorker())
        if (stage === 'registration') {
          vi.mocked(navigator.serviceWorker.register).mockImplementation(async () => {
            await pending.promise
            return { active: {}, scope: 'https://example.test/assets/' } as ServiceWorkerRegistration
          })
        }
        const session = create({
          workerFactory,
          ...(stage === 'transform' ? { transform: () => pending.promise } : {}),
        })
        const run = session.run()
        await flushMicrotasks()
        session.close()
        await expect(run).resolves.toMatchObject({
          status: 'error',
          error: { message: expect.stringContaining('closed') },
        })
        pending.resolve('export const value = 1')
        await flushMicrotasks()
        expect(workerFactory).not.toHaveBeenCalled()
      },
    )
  })
})
