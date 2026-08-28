// Page-realm test: an infinite loop in user code terminates the worker with
// a timeout error and the session recovers for the next run.
import { createRunesm } from '/runesm/index.mjs'

test('infinite loop times out, terminates, and the session recovers', async () => {
  const session = createRunesm({
    workerUrl: '/runesm/worker-entry.mjs',
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
