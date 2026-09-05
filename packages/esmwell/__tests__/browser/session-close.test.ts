import { adaptWorker, createModuleProjectSession, createTestSession } from '/esmwell/index.mjs'

for (const kind of ['project', 'test'] as const) {
  test(`closing an active ${kind} session terminates its worker and removes its graph`, async () => {
    const workers: Worker[] = []
    let terminated = 0
    const options = {
      workerUrl: `/esmwell/${kind === 'project' ? 'project' : 'test'}-worker-entry.mjs`,
      serviceWorkerUrl: '/esmwell/module-service-worker.mjs',
      timeoutMs: 30_000,
      workerFactory: (url: string) => {
        const worker = new Worker(url, { type: 'module' })
        workers.push(worker)
        const adapter = adaptWorker(worker)
        return {
          ...adapter,
          terminate: () => {
            terminated += 1
            adapter.terminate()
          },
        }
      },
    }
    const before = await caches.keys()
    const started = Promise.withResolvers<void>()
    const handlers = { onConsoleChunk: () => started.resolve() }
    const modules = { main: `console.log('started'); await new Promise(() => {})` }
    const session = kind === 'project' ? createModuleProjectSession(options) : createTestSession(options)
    try {
      const run =
        kind === 'project'
          ? session.run({ modules, entry: 'main' }, handlers)
          : session.run({ engine: 'vitest', modules, testFiles: ['main'] }, handlers)
      await started.promise
      session.close()
      assert(terminated === 1, 'close should terminate the active worker immediately')
      const result = await run
      assert(
        result.status === 'error' && result.error?.message.includes('closed'),
        'the run should report session closure',
      )
      assert(result.console.length > 0, 'closure should preserve streamed console output')
      const remaining = (await caches.keys()).filter(
        (name) => name.startsWith('esmwell:test-graph:') && !before.includes(name),
      )
      assertEqual(remaining, [], 'closure should remove the run graph')
    } finally {
      session.close()
      for (const worker of workers) worker.terminate()
    }
  })
}
