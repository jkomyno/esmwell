import { createEsmwell } from '/esmwell/index.mjs'

const EFFECT_V4_TAG = 'beta'

const runEffect = async (code: string, expected: unknown) => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
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
      export const solve = () => Schema.decodeUnknownSync(User)({ name: 'esmwell' })
    `,
    { name: 'esmwell' },
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

test('exposes one browser process through node:process and globalThis', async () => {
  const result = await runEffect(
    `
      import bareProcess from 'process'
      import process, { browser, cwd } from 'node:process'

      export const solve = () => ({
        sameObject: bareProcess === process && process === globalThis.process,
        browser,
        cwd: cwd(),
        claimsNode: typeof process.versions.node === 'string',
      })
    `,
    { sameObject: true, browser: true, cwd: '/', claimsNode: false },
  )

  assert(result.ok === true, `node:process should match globalThis.process: ${result.error?.message}`)
})

test('runs effect v4 beta Path.resolve for relative paths', async () => {
  const result = await runEffect(
    `
      import * as Effect from 'effect@beta/Effect'
      import * as Path from 'effect@beta/Path'

      export const solve = () => Effect.runPromise(
        Effect.gen(function*() {
          const path = yield* Path.Path
          return path.resolve('workspace', 'file.ts')
        }).pipe(Effect.provide(Path.layer)),
      )
    `,
    '/workspace/file.ts',
  )

  assert(result.ok === true, `Path.resolve should run: ${result.cases[0]?.error?.message ?? result.error?.message}`)
})

test('runs effect v4 beta CLI platform detection', async () => {
  const result = await runEffect(
    `
      import * as Effect from 'effect@beta/Effect'
      import { Prompt } from 'effect@beta/unstable/cli'

      export const solve = () => Effect.runPromise(Prompt.platformFigures).then((figures) => figures.tick)
    `,
    '✔',
  )

  assert(
    result.ok === true,
    `CLI platform detection should run: ${result.cases[0]?.error?.message ?? result.error?.message}`,
  )
})

// Guards the snippet published in the README and the playground demo: a
// Schema decode inside Effect.gen, a yield* Console.log that must reach the
// streamed console, and Effect.runFork observed to completion.
test('runs the documented Schema + Console.log + runFork snippet', async () => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 30_000,
  })
  try {
    const result = await session.runJudge(
      `
        import * as Console from 'effect@beta/Console'
        import * as Effect from 'effect@beta/Effect'
        import * as Schema from 'effect@beta/Schema'

        const User = Schema.Struct({ name: Schema.String, age: Schema.Number })

        export const solve = (input) => {
          const program = Effect.gen(function* () {
            const user = Schema.decodeUnknownSync(User)(input)
            yield* Console.log(\`decoded \${user.name} (age \${user.age})\`)
            return \`hello, \${user.name}\`
          })

          return new Promise((resolve) => {
            Effect.runFork(program).addObserver((exit) => resolve(exit.value))
          })
        }
      `,
      [
        {
          name: 'greets a decoded user',
          exportName: 'solve',
          args: [{ name: 'esmwell', age: 3 }],
          expected: 'hello, esmwell',
        },
        {
          name: 'greets another user',
          exportName: 'solve',
          args: [{ name: 'effect', age: 4 }],
          expected: 'hello, effect',
        },
      ],
    )

    assert(
      result.ok === true,
      `documented snippet should pass: ${result.cases[0]?.error?.message ?? result.error?.message}`,
    )

    const logged = result.console.map((chunk) => chunk.parts.join(' '))
    assert(
      logged.includes('decoded esmwell (age 3)'),
      `Console.log should stream through esmwell: got ${JSON.stringify(logged)}`,
    )
    assert(
      logged.includes('decoded effect (age 4)'),
      `Console.log should stream for every case: got ${JSON.stringify(logged)}`,
    )
  } finally {
    session.close()
  }
})
