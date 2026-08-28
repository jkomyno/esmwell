import { createTestSession } from '/runesm/index.mjs'

const modulesFor = (engine: 'vitest' | 'jest') => ({
  'src/impl': `
    import { z } from 'zod'

    const User = z.object({ name: z.string().min(3) })
    export const parseName = (input) => User.parse(input).name.toUpperCase()
  `,
  'src/cycle-a': `
    import { readB } from 'src/cycle-b'
    export const readA = () => 'A'
    export const readCycle = () => readB()
  `,
  'src/cycle-b': `
    import { readA } from 'src/cycle-a'
    export const readB = () => 'B' + readA()
  `,
  'tests/impl.test': `
    import { describe, expect, it } from ${JSON.stringify(engine === 'vitest' ? 'vitest' : '@jest/globals')}
    import { parseName } from 'src/impl'
    import { readCycle } from 'src/cycle-a'

    describe('Zod 4 workspace', () => {
      it('imports and validates a local implementation', () => {
        expect(parseName({ name: 'runesm' })).toBe('RUNESM')
      })

      it('surfaces a Zod 4 validation failure', () => {
        expect(() => parseName({ name: 'x' })).toThrow()
      })

      it('reports an intentional assertion failure', () => {
        expect(parseName({ name: 'test' })).toBe('WRONG')
      })

      it('uses native ESM cycles and live bindings', () => {
        expect(readCycle()).toBe('BA')
      })
    })
  `,
})

test('runs current Vitest and Jest engines over local ESM modules with Zod 4', async () => {
  for (const engine of ['vitest', 'jest'] as const) {
    const session = createTestSession({
      workerUrl: '/runesm/test-worker-entry.mjs',
      serviceWorkerUrl: '/runesm/module-service-worker.mjs',
      deps: { zod: '4' },
      autoInstall: false,
      timeoutMs: 120_000,
    })
    try {
      const result = await session.run({
        engine,
        modules: modulesFor(engine),
        testFiles: ['tests/impl.test'],
      })

      assert(result.status === 'fail', `${engine} should report the intentional failure: ${JSON.stringify(result)}`)
      assert(result.engine?.name === engine, `${engine} should identify itself`)
      assert(
        result.engine?.version !== undefined && /^\d+\.\d+\.\d+/.test(result.engine.version),
        `${engine} should report an exact resolved version`,
      )
      assertEqual(
        result.tests.map((testResult) => testResult.status),
        ['pass', 'pass', 'fail', 'pass'],
        `${engine} normalized test statuses`,
      )
      assert(
        result.dependencies.some((dependency) => dependency.name === 'zod' && dependency.version === '4'),
        `${engine} should report the pinned Zod 4 dependency`,
      )
    } finally {
      session.close()
    }
  }
})

test('reports missing canonical modules before loading a test engine and cleans graph caches', async () => {
  const session = createTestSession({
    workerUrl: '/runesm/test-worker-entry.mjs',
    serviceWorkerUrl: '/runesm/module-service-worker.mjs',
    autoInstall: false,
    timeoutMs: 10_000,
  })
  try {
    const result = await session.run({
      engine: 'vitest',
      modules: {
        'tests/missing.test': `
          import { it } from 'vitest'
          import { missing } from 'src/missing'
          it('never registers', () => missing())
        `,
      },
      testFiles: ['tests/missing.test'],
    })

    assert(result.status === 'error', 'a missing canonical module should be a workspace error')
    assert(
      result.error?.message.includes("could not find local module 'src/missing'") === true,
      `missing-local error should name the canonical id: ${result.error?.message}`,
    )
    const cacheNames = await caches.keys()
    assert(
      cacheNames.every((name) => !name.startsWith('runesm:test-graph:')),
      `test graph caches should be removed after failure: ${cacheNames.join(', ')}`,
    )
  } finally {
    session.close()
  }
})

test('terminates a synchronous test loop and cleans its virtual graph', async () => {
  const session = createTestSession({
    workerUrl: '/runesm/test-worker-entry.mjs',
    serviceWorkerUrl: '/runesm/module-service-worker.mjs',
    timeoutMs: 2_000,
  })
  try {
    const result = await session.run({
      engine: 'vitest',
      modules: {
        'tests/hang.test': `
          import { it } from 'vitest'
          it('hangs', () => { while (true) {} })
        `,
      },
      testFiles: ['tests/hang.test'],
    })

    assert(result.error?.name === 'TimeoutError', `hung test should time out: ${JSON.stringify(result)}`)
    const cacheNames = await caches.keys()
    assert(
      cacheNames.every((name) => !name.startsWith('runesm:test-graph:')),
      `test graph caches should be removed after timeout: ${cacheNames.join(', ')}`,
    )
  } finally {
    session.close()
  }
})

test('allows focused tests on both engines', async () => {
  for (const engine of ['vitest', 'jest'] as const) {
    const session = createTestSession({
      workerUrl: '/runesm/test-worker-entry.mjs',
      serviceWorkerUrl: '/runesm/module-service-worker.mjs',
      timeoutMs: 120_000,
    })
    try {
      const testModule = engine === 'vitest' ? 'vitest' : '@jest/globals'
      const result = await session.run({
        engine,
        modules: {
          'tests/focused.test': `
            import { it } from ${JSON.stringify(testModule)}
            it('first', () => {})
            it.only('focused', () => {})
            it('last', () => {})
          `,
        },
        testFiles: ['tests/focused.test'],
      })
      const statuses = result.tests.map((testResult) => testResult.status)

      assert(result.status === 'pass', `${engine} should allow a focused test: ${JSON.stringify(result)}`)
      assertEqual(
        statuses.filter((status) => status === 'pass').length,
        1,
        `${engine} should run exactly one focused test`,
      )
      assert(
        statuses.every((status) => status !== 'fail'),
        `${engine} should not report a focused run as failed: ${statuses.join(', ')}`,
      )
    } finally {
      session.close()
    }
  }
})

test('reports an empty workspace as an error on both engines', async () => {
  for (const engine of ['vitest', 'jest'] as const) {
    const session = createTestSession({
      workerUrl: '/runesm/test-worker-entry.mjs',
      serviceWorkerUrl: '/runesm/module-service-worker.mjs',
      timeoutMs: 120_000,
    })
    try {
      const testModule = engine === 'vitest' ? 'vitest' : '@jest/globals'
      const result = await session.run({
        engine,
        modules: {
          'tests/empty.test': `import { describe } from ${JSON.stringify(testModule)}`,
        },
        testFiles: ['tests/empty.test'],
      })

      assert(result.status === 'error', `${engine} should report an empty workspace as an error`)
      assert(result.ok === false, `${engine} should not accept an empty workspace`)
      if (engine === 'vitest') {
        assert(result.error?.name === 'Error', `Vitest should keep its engine error: ${JSON.stringify(result)}`)
        assert(
          result.error.message.includes('No test suite found'),
          `Vitest should explain its engine error: ${JSON.stringify(result)}`,
        )
      } else {
        assert(
          result.error?.name === 'NoTestsError',
          `Jest's clean empty outcome should become a NoTestsError: ${JSON.stringify(result)}`,
        )
      }
    } finally {
      session.close()
    }
  }
})
