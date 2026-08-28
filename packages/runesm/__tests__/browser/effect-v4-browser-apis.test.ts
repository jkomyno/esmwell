import { createRunesm } from '/runesm/index.mjs'

const runEffect = async (code: string, expected: unknown) => {
  const session = createRunesm({
    workerUrl: '/runesm/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 30_000,
  })
  try {
    return await session.runJudge(code, [{ name: 'Effect browser API', exportName: 'solve', expected }])
  } finally {
    session.close()
  }
}

test('reads Effect configuration from the browser process environment', async () => {
  const result = await runEffect(
    `
      import * as Config from 'effect@beta/Config'
      import * as ConfigProvider from 'effect@beta/ConfigProvider'
      import * as Effect from 'effect@beta/Effect'

      export const solve = () => {
        process.env.RUNESM_MODE = 'browser'
        const provider = ConfigProvider.fromEnv()
        return Effect.runSync(Config.string('RUNESM_MODE').parse(provider))
      }
    `,
    'browser',
  )

  assert(result.ok === true, `ConfigProvider.fromEnv should run: ${result.error?.message}`)
})

test('round-trips browser File values through Effect Schema', async () => {
  const result = await runEffect(
    `
      import * as Schema from 'effect@beta/Schema'

      export const solve = async () => {
        const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
        const encoded = await Schema.encodePromise(Schema.File)(file)
        const decoded = await Schema.decodeUnknownPromise(Schema.File)(encoded)
        return { name: decoded.name, type: decoded.type, text: await decoded.text() }
      }
    `,
    { name: 'hello.txt', type: 'text/plain', text: 'hello' },
  )

  assert(result.ok === true, `Schema.File should run: ${result.error?.message}`)
})

test('round-trips MessagePack through Effect unstable encoding', async () => {
  const result = await runEffect(
    `
      import * as Schema from 'effect@beta/Schema'
      import { Msgpack } from 'effect@beta/unstable/encoding'

      const Payload = Schema.Struct({ id: Schema.Number, label: Schema.String })
      const Codec = Msgpack.schema(Payload)

      export const solve = () => {
        const encoded = Schema.encodeSync(Codec)({ id: 7, label: 'runesm' })
        return Schema.decodeUnknownSync(Codec)(encoded)
      }
    `,
    { id: 7, label: 'runesm' },
  )

  assert(result.ok === true, `Msgpack should run: ${result.error?.message}`)
})

test('executes Effect FetchHttpClient through the worker fetch API', async () => {
  const result = await runEffect(
    `
      import * as Effect from 'effect@beta/Effect'
      import { FetchHttpClient, HttpClient } from 'effect@beta/unstable/http'

      export const solve = () => Effect.runPromise(
        Effect.flatMap(HttpClient.get(location.origin + '/'), (response) => response.text).pipe(
          Effect.map((body) => body.includes('<title>runesm browser tests</title>')),
          Effect.provide(FetchHttpClient.layer),
        ),
      )
    `,
    true,
  )

  assert(result.ok === true, `FetchHttpClient should run: ${result.cases[0]?.error?.message ?? result.error?.message}`)
})
