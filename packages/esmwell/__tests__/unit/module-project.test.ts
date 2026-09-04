import { createModuleProjectSession } from 'src/main'
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
    vi.stubGlobal('caches', { delete: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('transforms and forwards a project, then terminates its fresh worker and deletes its graph', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]
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
    expect(workers[0]!.sent[0]).toMatchObject({
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

    workers[0]!.emitMessage({ kind: 'module-project-result', id: 1, result: okProjectResult })
    await expect(first).resolves.toEqual(okProjectResult)
    expect(workers[0]!.terminated).toBe(true)
    expect(caches.delete).toHaveBeenCalledWith(expect.stringMatching(/^esmwell:module-graph:v1:/))

    const second = session.run({ modules: { main: `export const answer = 42` }, entry: 'main' })
    await flushMicrotasks()
    expect(workers[1]!.sent).toHaveLength(1)
    workers[1]!.emitMessage({ kind: 'module-project-result', id: 1, result: okProjectResult })
    await expect(second).resolves.toEqual(okProjectResult)
    expect(workers[1]!.terminated).toBe(true)
  })
})
