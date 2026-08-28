import { createRunesm } from '/runesm/index.mjs'

const EFFECT_V4_TAG = 'beta'

const runEffect = async (code: string, expected: unknown) => {
  const session = createRunesm({
    workerUrl: '/runesm/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 30_000,
  })
  try {
    return await session.runJudge(code, [{ name: 'effect v4 beta', exportName: 'solve', expected }])
  } finally {
    session.close()
  }
}

test('loads effect v4 beta Schema without platform packages', async () => {
  const result = await runEffect(
    `
      import * as Schema from 'effect@beta/Schema'

      const User = Schema.Struct({ name: Schema.String })
      export const solve = () => Schema.decodeUnknownSync(User)({ name: 'runesm' })
    `,
    { name: 'runesm' },
  )

  assert(result.ok === true, `Schema should run: ${result.error?.message}`)
  assertEqual(
    result.dependencies,
    [
      {
        specifier: 'effect@beta/Schema',
        name: 'effect',
        version: EFFECT_V4_TAG,
        url: `https://esm.sh/effect@${EFFECT_V4_TAG}/Schema`,
      },
    ],
    'Schema should load only effect',
  )
})

test('runs effect v4 beta with Effect.runFork', async () => {
  const result = await runEffect(
    `
      import * as Effect from 'effect@beta/Effect'

      export const solve = () => new Promise((resolve) => {
        Effect.runFork(Effect.succeed('forked')).addObserver((exit) => resolve(exit.value))
      })
    `,
    'forked',
  )

  assert(result.ok === true, `Effect.runFork should run: ${result.error?.message}`)
})

test('runs effect v4 beta Effect.acquireRelease in a scope', async () => {
  const result = await runEffect(
    `
      import * as Effect from 'effect@beta/Effect'

      export const solve = () => {
        const events = []
        const program = Effect.scoped(
          Effect.acquireRelease(
            Effect.sync(() => { events.push('acquire'); return 'resource' }),
            () => Effect.sync(() => { events.push('release') }),
          ).pipe(Effect.map((resource) => resource)),
        )
        return new Promise((resolve) => {
          Effect.runFork(program).addObserver((exit) => resolve({ value: exit.value, events }))
        })
      }
    `,
    { value: 'resource', events: ['acquire', 'release'] },
  )

  assert(result.ok === true, `Effect.acquireRelease should run: ${result.error?.message}`)
})
