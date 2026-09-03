// Page-realm test: an infinite loop in user code terminates the worker with
// a timeout error and the session recovers for the next run.
import { createEsmwell } from '/esmwell/index.mjs'

test('infinite loop times out, terminates, and the session recovers', async () => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    timeoutMs: 1000,
  })
  try {
    const timedOut = await session.runJudge('export const spin = () => { while (true) { /* stuck */ } }', [
      { name: 'spins forever', exportName: 'spin' },
    ])

    assert(timedOut.status === 'error', 'a hung run reports an error status')
    assert(timedOut.error?.name === 'TimeoutError', `expected TimeoutError, got ${timedOut.error?.name}`)
    assert(timedOut.error?.message.includes('terminated') === true, 'the error explains the termination')

    const recovered = await session.runJudge('export const solve = () => 7', [
      { name: 'recovers', exportName: 'solve', expected: 7 },
    ])
    assert(recovered.ok === true, 'the next run uses a fresh worker')
  } finally {
    session.close()
  }
})

test('judge runs use fresh realms with protected runtime globals', async () => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    timeoutMs: 5000,
  })
  try {
    const protectedResult = await session.runJudge(
      `export const probe = () => {
        setTimeout(() => console.log('late output from a dead realm'), 25)
        const originalProcess = globalThis.process
        const originalConsole = globalThis.console
        let processRedefined = true
        let consoleRedefined = true
        try { Object.defineProperty(globalThis, 'process', { value: {} }) } catch { processRedefined = false }
        try { Object.defineProperty(globalThis, 'console', { value: {} }) } catch { consoleRedefined = false }
        return {
          processSet: Reflect.set(globalThis, 'process', {}),
          processDeleted: Reflect.deleteProperty(globalThis, 'process'),
          processRedefined,
          processMethodSet: Reflect.set(originalProcess, 'cwd', () => '/tmp'),
          consoleSet: Reflect.set(globalThis, 'console', {}),
          consoleDeleted: Reflect.deleteProperty(globalThis, 'console'),
          consoleRedefined,
          consoleMethodSet: Reflect.set(originalConsole, 'log', () => {}),
          processIdentityKept: globalThis.process === originalProcess,
          consoleIdentityKept: globalThis.console === originalConsole,
        }
      }`,
      [
        {
          name: 'protected globals',
          exportName: 'probe',
          expected: {
            processSet: false,
            processDeleted: false,
            processRedefined: false,
            processMethodSet: false,
            consoleSet: false,
            consoleDeleted: false,
            consoleRedefined: false,
            consoleMethodSet: false,
            processIdentityKept: true,
            consoleIdentityKept: true,
          },
        },
      ],
    )
    assert(protectedResult.ok === true, `runtime globals should be protected: ${JSON.stringify(protectedResult)}`)

    await new Promise((resolve) => setTimeout(resolve, 50))
    const next = await session.runJudge('export const clean = () => globalThis.process.cwd()', [
      { name: 'fresh realm', exportName: 'clean', expected: '/' },
    ])
    assert(next.ok === true, `the next judge run should use a clean realm: ${JSON.stringify(next)}`)
    assert(next.console.length === 0, `late output must not cross runs: ${JSON.stringify(next.console)}`)
  } finally {
    session.close()
  }
})
