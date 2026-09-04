# Effect v4 beta in esmwell

Use the `beta` tag in each import because esm.sh's unqualified `latest` version is Effect v3. An exact version such as `effect@4.0.0-beta.107/Schema` works too. The core `effect` package runs directly in the browser worker. No `@effect/platform-*` package is needed.

## The demo program

This is the program shown in the playground recording: a `Schema` decode inside `Effect.gen`, a `yield* Console.log` that streams out while the fiber runs, and `Effect.runFork` observed to completion.

```js
import * as Console from 'effect@beta/Console'
import * as Effect from 'effect@beta/Effect'
import * as Schema from 'effect@beta/Schema'

const User = Schema.Struct({ name: Schema.String, age: Schema.Number })

export const solve = (input) => {
  const program = Effect.gen(function* () {
    const user = Schema.decodeUnknownSync(User)(input)
    yield* Console.log(`decoded ${user.name} (age ${user.age})`)
    return `hello, ${user.name}`
  })

  return new Promise((resolve) => {
    Effect.runFork(program).addObserver((exit) => resolve(exit.value))
  })
}
```

```ts
import { createEsmwell } from 'esmwell'

const session = createEsmwell({ autoInstall: false, timeoutMs: 30_000 })

const result = await session.runJudge(code, [
  {
    name: 'greets a decoded user',
    exportName: 'solve',
    args: [{ name: 'esmwell', age: 3 }],
    expected: 'hello, esmwell',
  },
])
// result.console → [{ level: 'log', parts: ['decoded esmwell (age 3)'] }]
```

The real-browser suite covers this snippet, `effect@beta/Schema`, `Effect.runFork`, scoped `Effect.acquireRelease`, and every published stable, testing, and top-level unstable entrypoint against the published beta tag.

## `process` expectations

Effect's `Path.layer` consults `globalThis.process.cwd()` for relative paths. esmwell installs the same browser-oriented object behind `globalThis.process`, `process`, and `node:process`: it reports `browser: true`, uses `/` as its fixed working directory, and deliberately leaves `versions.node` absent so dependencies can distinguish it from Node.

## Host-capability ledger

The following entrypoints load, but their main operations need host services that a plain browser worker does not provide. They stay outside esmwell's compatibility layer rather than receiving misleading no-op implementations.

| Capability                                                             | Observed error without a service                 | What support would require                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `effect/FileSystem`                                                    | `Service not found: effect/platform/FileSystem`  | A virtual filesystem, path/URL semantics, persistence, and lifecycle contract |
| `effect/Terminal` and interactive CLI prompts                          | `Service not found: effect/platform/Terminal`    | Bidirectional host I/O, cancellation, dimensions, and input-mode handling     |
| Fetch response `Set-Cookie` values                                     | Browser Fetch exposes an empty cookie collection | A privileged host/proxy that can observe forbidden response headers           |
| HTTP servers, cluster runners, and sockets without a browser transport | Missing server/socket services                   | A host routing bridge and explicit network/listener lifecycle                 |
| SQL, persistence, event log, and durable workflows                     | Missing storage/client services                  | A selected browser storage backend plus transaction and durability semantics  |

Fetch-based HTTP clients and global WebSocket constructors remain usable because they build on browser-native APIs. `@effect/platform-*` packages are not part of the compatibility probe or runtime.
