// Page-realm test: a REPL session over the real module worker persists
// declarations, imports, and console capture across inputs.
import { createReplSession } from '/runesm/index.mjs'

test('REPL session persists state across evaluations in the worker', async () => {
  const session = createReplSession({
    workerUrl: '/runesm/worker-entry.mjs',
    deps: { 'is-even': '1.0.0' },
    timeoutMs: 30_000,
  })
  try {
    const declared = await session.evaluate('let count = 0')
    assert(declared.ok === true, `declaration failed: ${declared.error?.message}`)

    await session.evaluate('count++')
    const read = await session.evaluate('count')
    assert(read.value === 1, `count should persist as 1, got ${JSON.stringify(read.value)}`)

    const imported = await session.evaluate(`import isEven from 'is-even'\nconst label = isEven(2) ? 'even' : 'odd'`)
    assert(imported.ok === true, `import failed: ${imported.error?.message}`)
    assert(
      imported.dependencies.some((dependency) => dependency.name === 'is-even'),
      'the imported dependency is surfaced',
    )

    const label = await session.evaluate('label')
    assert(label.value === 'even', `label should persist as 'even', got ${JSON.stringify(label.value)}`)

    const chunks = []
    const logged = await session.evaluate("console.log('streaming')", {
      onConsoleChunk: (chunk) => {
        chunks.push(chunk.parts.join(' '))
      },
    })
    assert(logged.console.length === 1 && logged.console[0].parts[0] === 'streaming', 'console captured')
    assert(chunks.join(',') === 'streaming', 'console streamed')

    const failed = await session.evaluate('missing()')
    assert(failed.ok === false, 'errors report ok=false')
    assert((failed.error?.message ?? '').includes('missing'), 'errors carry the message')

    const survived = await session.evaluate('count + 1')
    assert(survived.value === 2, 'the session survives errors')
  } finally {
    session.close()
  }
})

test('REPL-reached WebIDL globals work through the persistent scope proxy', async () => {
  // Regression coverage: the transform rewrites every free identifier to a
  // member access on the shared scope proxy (`setTimeout` becomes
  // `__runesm.setTimeout`), and WebIDL operations reject a receiver that
  // isn't the real global. This only reproduces in a real worker realm.
  const session = createReplSession({
    workerUrl: '/runesm/worker-entry.mjs',
    timeoutMs: 30_000,
  })
  try {
    const encoded = await session.evaluate("btoa('hi')")
    assert(encoded.ok === true, `btoa failed: ${encoded.error?.message}`)
    assert(encoded.value === 'aGk=', `btoa('hi') should be 'aGk=', got ${JSON.stringify(encoded.value)}`)

    const sleepDefined = await session.evaluate(
      'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))',
    )
    assert(sleepDefined.ok === true, `defining sleep failed: ${sleepDefined.error?.message}`)
    const slept = await session.evaluate('await sleep(1)\n"awoke"')
    assert(slept.ok === true, `setTimeout inside sleep() failed: ${slept.error?.message}`)
    assert(slept.value === 'awoke', `sleep() should resolve, got ${JSON.stringify(slept.value)}`)

    const cloned = await session.evaluate('structuredClone({ a: 1 })')
    assert(cloned.ok === true, `structuredClone failed: ${cloned.error?.message}`)
    assertEqual(cloned.value, { a: 1 }, 'structuredClone returns an equivalent clone')

    const queued = await session.evaluate("await new Promise((resolve) => queueMicrotask(() => resolve('done')))")
    assert(queued.ok === true, `queueMicrotask failed: ${queued.error?.message}`)
    assert(queued.value === 'done', `queueMicrotask should resolve, got ${JSON.stringify(queued.value)}`)
  } finally {
    session.close()
  }
})

test('REPL reset starts a fresh scope over the transport', async () => {
  const session = createReplSession({
    workerUrl: '/runesm/worker-entry.mjs',
    timeoutMs: 30_000,
  })
  try {
    await session.evaluate('let kept = 41')
    await session.reset()
    const read = await session.evaluate('kept')
    assert(read.value === undefined, `kept should be gone after reset, got ${JSON.stringify(read.value)}`)
  } finally {
    session.close()
  }
})
