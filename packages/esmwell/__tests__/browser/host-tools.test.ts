import { createHostTools } from '/esmwell/host-tools.mjs'
import type { HostToolCall } from '/esmwell/host-tools.mjs'
import { createEsmwell, createModuleProjectSession, createReplSession, createTestSession } from '/esmwell/index.mjs'

test('a judge calls only registered host tools and reports failures without leaking host errors', async () => {
  const calls: HostToolCall[] = []
  const session = createEsmwell({
    hostTools: createHostTools({
      tools: {
        add: ([left, right]) => Number(left) + Number(right),
        badResult: () => () => undefined,
        fails: () => {
          throw new Error('host-only detail')
        },
      },
      onCall: (call) => calls.push(call),
    }),
  })
  try {
    const result = await session.runJudge(
      `const add = globalThis.esmwellHostCall
       export async function run() {
         const results = await Promise.allSettled([
           add('add', 20, 22), add('constructor'), add('badResult'), add('fails'), add('add', () => 1),
         ])
         return results.map((result) =>
           result.status === 'fulfilled' ? result.value : [result.reason.name, result.reason.message]
         )
       }`,
      [
        {
          name: 'host calls',
          exportName: 'run',
          expected: [
            42,
            ['HostToolError', 'the requested host tool is not registered'],
            ['HostToolError', 'the host tool returned a value that could not be cloned'],
            ['HostToolError', 'the host tool failed'],
            ['HostToolError', 'the host tool arguments could not be cloned'],
          ],
        },
      ],
    )
    assert(result.ok, `judge result: ${JSON.stringify(result)}`)
    assert(
      JSON.stringify(calls.sort((left, right) => left.id - right.id)) ===
        JSON.stringify([
          { runId: 1, id: 1, tool: 'add', status: 'success' },
          { runId: 1, id: 2, tool: 'constructor', status: 'denied' },
          { runId: 1, id: 3, tool: 'badResult', status: 'error' },
          { runId: 1, id: 4, tool: 'fails', status: 'error' },
        ]),
      `host audit: ${JSON.stringify(calls)}`,
    )
  } finally {
    session.close()
  }
})

test('a REPL timeout aborts its host calls and later evaluations get a fresh channel', async () => {
  const calls: HostToolCall[] = []
  let pendingSignal: AbortSignal | undefined
  const repl = createReplSession({
    timeoutMs: 1_000,
    hostTools: createHostTools({
      tools: {
        wait: (_args, { signal }) => {
          pendingSignal = signal
          return new Promise(() => {})
        },
        echo: ([value]) => value,
      },
      onCall: (call) => calls.push(call),
    }),
  })
  try {
    const timedOut = await repl.evaluate("await globalThis.esmwellHostCall('wait')")
    assert(timedOut.error?.name === 'TimeoutError', `hung host tool: ${JSON.stringify(timedOut)}`)
    assert(pendingSignal?.aborted === true, 'the timed-out run should abort the host handler')

    const first = await repl.evaluate(
      "const echo = (value) => globalThis.esmwellHostCall('echo', value)\nawait echo(21)",
    )
    const second = await repl.evaluate('await echo(42)')
    assert(first.value === 21 && second.value === 42, `recovered values: ${JSON.stringify([first, second])}`)
    assert(
      JSON.stringify(calls.map(({ runId, status }) => [runId, status])) ===
        JSON.stringify([
          [1, 'cancelled'],
          [2, 'success'],
          [3, 'success'],
        ]),
      `host audit: ${JSON.stringify(calls)}`,
    )
  } finally {
    repl.close()
  }
})

test('module projects and test workspaces use the host tools on their directly owned workers', async () => {
  const hostTools = createHostTools({ tools: { answer: () => 42 } })
  const project = createModuleProjectSession({ hostTools })
  const workspace = createTestSession({ hostTools })
  try {
    const result = await project.run({
      modules: { 'src/main': "export const answer = await globalThis.esmwellHostCall('answer')" },
      entry: 'src/main',
    })
    assert(result.exports.answer === 42, `project result: ${JSON.stringify(result)}`)

    const tested = await workspace.run({
      engine: 'vitest',
      modules: {
        'tests/host.test': `
          import { it, expect } from 'vitest'
          it('reads from the host', async () => {
            expect(await globalThis.esmwellHostCall('answer')).toBe(42)
          })
        `,
      },
      testFiles: ['tests/host.test'],
    })
    assert(tested.ok, `workspace result: ${JSON.stringify(tested)}`)
  } finally {
    project.close()
    workspace.close()
  }
})
