# runesm

Run unbundled ESM in the browser with hard timeouts, dependency resolution, and normalized results.

`runesm` provides judge, persistent REPL, and lazy Vitest/Jest workspace APIs. Bare imports such as `import isEven from 'is-even'` resolve at runtime through [esm.sh](https://esm.sh), console output streams back while code executes, and an infinite loop becomes a typed timeout result instead of freezing the page.

## Install

```bash
pnpm add runesm
```

The package ships ESM only (`.mjs`), with a single runtime dependency on [acorn](https://github.com/acornjs/acorn).

## Execution model

Judge and REPL sessions use two worker levels:

```text
page → coordinator worker → execution worker
```

The coordinator never evaluates submitted code. It owns the deadline and terminates the execution worker on timeout or fatal failure. Every judge run starts in a fresh execution worker. A REPL keeps one worker so declarations persist, then discards it on reset, timeout, or fatal failure.

Test workspaces use one fresh page-owned worker per run. Their virtual module graph is backed by a scoped service worker, and direct ownership keeps that graph portable across Chromium and WebKit.

Bindings installed by runesm, including `globalThis.process`, `globalThis.console`, and test-engine bridges, are non-writable and non-configurable. Submitted code cannot replace or delete them. Their intended contents can still be mutable, so `process.env.KEY = 'value'` remains supported.

Worker isolation makes execution disposable and lets the host recover from synchronous infinite loops. It does not turn a browser worker into a process, VM, V8 isolate, or workerd security boundary. Submitted code retains browser worker capabilities allowed by the page, including same-origin and network access unless the host restricts them.

## Vitest and Jest workspaces

Run real current Vitest or Jest engine packages over a virtual ESM project.
Canonical local ids take precedence over npm packages, so test files can use
imports such as `import { impl } from 'src/impl'` without a filesystem:

```ts
import { createTestSession } from 'runesm'

const tests = createTestSession({
  workerUrl: '/assets/runesm/test-worker-entry.mjs',
  serviceWorkerUrl: '/assets/runesm/module-service-worker.mjs',
  deps: { zod: '4' },
  autoInstall: false,
})

const result = await tests.run({
  engine: 'vitest', // or 'jest'
  modules: {
    'src/impl': `
      import { z } from 'zod'
      const Input = z.object({ value: z.number() })
      export const double = (input) => Input.parse(input).value * 2
    `,
    'tests/impl.test': `
      import { describe, expect, it } from 'vitest'
      import { double } from 'src/impl'

      describe('double', () => {
        it('validates with Zod 4', () => {
          expect(double({ value: 2 })).toBe(4)
        })
      })
    `,
  },
  testFiles: ['tests/impl.test'],
})

// result.engine.version is the exact version selected from esm.sh.
// result.tests contains normalized pass/fail/skip/todo cases.
tests.close()
```

Test sessions default to `timeoutMs: 60000` because the same budget covers
the engine download and test run. Judge and REPL sessions keep the 5-second
default.

For Jest, import the same globals from `@jest/globals`. `jest.fn` and
`jest.spyOn` use the official `jest-mock` package. Both engines and their
assertion libraries load lazily from esm.sh; judge and REPL users do not pay
their download cost. The current browser test payload is much larger than the
runner core—roughly 2.1 MB uncompressed for Jest—so websites should start the
download when a user opens or runs a test playground, not during initial page
load.

The virtual graph uses native browser ESM, including cycles, live bindings,
relative imports, re-exports, and literal dynamic imports. Exact canonical ids
under `src/` and `tests/` are treated as local; missing ids produce an
actionable workspace error instead of resolving an npm package with the same
name.

### Hosting the test assets

Test mode needs the published `test-worker-entry.mjs` and
`module-service-worker.mjs` files served from the website's origin and from
the same directory. That directory becomes the service-worker scope. HTTPS is
required outside localhost. Pass explicit URLs when a bundler relocates the
files; a blob-built execution worker cannot participate in this mode. The
service worker only answers runesm's versioned virtual-module path beneath its
scope and leaves other requests untouched.

Each test run creates and terminates its own worker. A timeout therefore clears engine registration state and the virtual module graph before the next run.

### Compatibility boundary

This is an ESM playground API backed by official engine components, not the
Vitest or Jest Node CLI. It supports suites, tests, hooks, upstream assertions,
Vitest `vi.fn`, Jest mock functions, and normalized results. Config files,
plugins, watch mode, coverage, filesystem discovery, CJS, Node environments,
and module mocking are not supported. Snapshots are currently in-memory for a
single Vitest run. Jest assertion-count enforcement is unavailable because it
depends on Jest's private environment adapter. A workspace that registers no
tests is an error; a clean engine outcome with no registered tests becomes a
`NoTestsError`, while an engine's own error details are preserved.
`it.only`/`describe.only` narrow the run on both engines.

## Judge mode

Run a module once against named-export test cases:

```ts
import { createRunesm } from 'runesm'

const session = createRunesm({
  deps: { 'is-even': '1.0.0' }, // pin versions; unpinned bare imports resolve to latest
  timeoutMs: 5000, // hard timeout; exceeding it terminates the worker
})

const result = await session.runJudge(
  `import isEven from 'is-even'
   export const solve = (n) => (isEven(n) ? 'even' : 'odd')`,
  [
    { name: 'two', exportName: 'solve', args: [2], expected: 'even' },
    { name: 'seven', exportName: 'solve', args: [7], expected: 'even' }, // fails
  ],
  {
    onConsoleChunk: (chunk) => console.log(chunk.level, ...chunk.parts), // streamed
  },
)
// result.status: 'pass' | 'fail' | 'error'
// result.cases[i].status / .actual / .expected / .error
// result.console, result.dependencies (name → version → URL), result.durationMs

session.close()
```

Results compare structurally (`NaN` equals `NaN`, `+0` ≠ `-0`, `Map`/`Set` ignore insertion order, TypedArrays compare byte-wise, prototypes must match). `RegExp` compares source and flags, boxed primitives compare their wrapped value, and `Error` compares class, `name`, `message`, and `cause` (never `stack`).

## REPL mode

A Node-style persistent scope: declarations, imports, and reassignments survive across inputs; closures observe later changes.

```ts
import { createReplSession } from 'runesm'

const repl = createReplSession({})

await repl.evaluate('let count = 0')
await repl.evaluate('count++')
const { value } = await repl.evaluate('count') // 1

await repl.evaluate('const get = () => count')
await repl.evaluate('count = 5')
const live = (await repl.evaluate('get()')).value // 5 — live binding

await repl.reset() // fresh scope
repl.close()
```

Each input's completion value (its final expression) comes back as `value`; `export` statements are rejected with a clear error since REPL inputs declare values instead.

The persistent scope is a plain object, so a few Node-REPL-like divergences are deliberate rather than accidental:

- Re-declaring a name with `let` reassigns it instead of erroring, as does re-declaring a `const` — both `let` and `const` become scope assignments, so a later input can even reassign an earlier `const`.
- Reading a name that was never declared returns `undefined` instead of throwing `ReferenceError`. This keeps `typeof someUndeclaredName` evaluating to `'undefined'`, matching the Node REPL, instead of throwing.

## Dependencies and autoInstall

- Bare specifiers in `import` / `export … from` / literal dynamic `import()` rewrite to `https://esm.sh/{name}@{version}` at runtime — no manifest, no bundler.
- `deps` pins exact versions; an inline version such as `effect@beta/Option` takes precedence; `autoInstall: true` (the default) resolves everything else to the CDN's latest.
- `autoInstall: false` makes an unpinned bare import an error: `could not resolve 'x' — check the package name or add it to deps`.
- Absolute URLs pass through untouched; relative specifiers error (user code runs from an in-memory URL). `process` and `node:process` resolve to the worker's browser process object; other `node:*` imports fail fast with module-specific pointers to browser alternatives (`node:crypto` → `globalThis.crypto`, `node:http` → `fetch()`, …).
- Both modes surface the resolved dependency list (`name`, `version`, `url`) in their results so hosts can display what a run actually used.

### Effect v4 beta

Use the `beta` tag in each import because esm.sh's unqualified `latest` version is Effect v3. An exact version such as `effect@4.0.0-beta.107/Schema` works too. The core `effect` package runs directly in the browser worker; no `@effect/platform-*` package is needed:

```ts
const session = createRunesm({
  autoInstall: false,
  timeoutMs: 30_000,
})

const result = await session.runJudge(
  `import * as Effect from 'effect@beta/Effect'
   import * as Schema from 'effect@beta/Schema'

   const User = Schema.Struct({ name: Schema.String })

   export const solve = () => {
     const user = Schema.decodeUnknownSync(User)({ name: 'runesm' })
     const events = []
     const program = Effect.scoped(
       Effect.acquireRelease(
         Effect.sync(() => { events.push('acquire'); return user }),
         () => Effect.sync(() => { events.push('release') }),
       ),
     )
     return new Promise((resolve) => {
       Effect.runFork(program).addObserver((exit) =>
         resolve({ name: exit.value.name, events }),
       )
     })
   }`,
  [
    {
      name: 'Effect v4 resource lifecycle',
      exportName: 'solve',
      expected: { name: 'runesm', events: ['acquire', 'release'] },
    },
  ],
)
```

The real-browser suite covers `effect@beta/Schema`, `Effect.runFork`, scoped `Effect.acquireRelease`, and all 156 published stable, testing, and top-level unstable entrypoints against the published beta tag.

Effect's `Path.layer` consults `globalThis.process.cwd()` for relative paths. runesm installs the same browser-oriented object behind `globalThis.process`, `process`, and `node:process`: it reports `browser: true`, uses `/` as its fixed working directory, and deliberately leaves `versions.node` absent so dependencies can distinguish it from Node.

### Effect host-capability ledger

The following entrypoints load, but their main operations need host services that a plain browser worker does not provide. They stay outside runesm's current compatibility layer rather than receiving misleading no-op implementations:

| Capability                                                             | Observed error without a service                 | What support would require                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `effect/FileSystem`                                                    | `Service not found: effect/platform/FileSystem`  | A virtual filesystem, path/URL semantics, persistence, and lifecycle contract |
| `effect/Terminal` and interactive CLI prompts                          | `Service not found: effect/platform/Terminal`    | Bidirectional host I/O, cancellation, dimensions, and input-mode handling     |
| Fetch response `Set-Cookie` values                                     | Browser Fetch exposes an empty cookie collection | A privileged host/proxy that can observe forbidden response headers           |
| HTTP servers, cluster runners, and sockets without a browser transport | Missing server/socket services                   | A host routing bridge and explicit network/listener lifecycle                 |
| SQL, persistence, event log, and durable workflows                     | Missing storage/client services                  | A selected browser storage backend plus transaction and durability semantics  |

Fetch-based HTTP clients and global WebSocket constructors remain usable because they build on browser-native APIs. `@effect/platform-*` packages are not part of the compatibility probe or runtime.

## WebAssembly packages

User modules run in a browser worker with the native `WebAssembly` and `fetch` APIs. They can fetch and instantiate a `.wasm` URL directly, or use a package's browser/Web Worker entrypoint when that package provides one.

Runtime-specific package entrypoints are not interchangeable. In particular, `@cf-wasm/og`'s default export resolves to its `workerd` build, which imports `.wasm` files using Cloudflare Workers module rules that browsers do not implement. Use the package's `others` entries and initialize their WebAssembly binaries explicitly:

```js
import { CustomFont, ImageResponse } from '@cf-wasm/og/others'
import { t } from '@cf-wasm/og/html-to-react'
import { initResvg } from '@cf-wasm/resvg/legacy/others'
import { initSatori } from '@cf-wasm/satori/others'

await Promise.all([
  initResvg(fetch('https://esm.sh/@cf-wasm/resvg@0.4.0/legacy/resvg.wasm?raw')),
  initSatori(fetch('https://esm.sh/@cf-wasm/satori@0.4.0/yoga.wasm?raw')),
])

export const renderImage = async () => {
  const defaultFont = new CustomFont(
    'sans serif',
    fetch('https://cdn.jsdelivr.net/npm/@cf-wasm/og@0.5.0/dist/lib/noto-sans-v27-latin-regular.ttf.bin').then(
      (response) => response.arrayBuffer(),
    ),
  )
  return ImageResponse.async(t('<div style="display: flex">Hello from WebAssembly</div>'), {
    width: 320,
    height: 180,
    defaultFont,
  })
}
```

Pin all three packages in the session because the submitted module imports each one directly:

```ts
createRunesm({
  deps: {
    '@cf-wasm/og': '0.5.0',
    '@cf-wasm/resvg': '0.4.0',
    '@cf-wasm/satori': '0.4.0',
  },
  autoInstall: false,
})
```

The browser suite executes this flow through the published worker entry and checks the generated PNG signature. The CDN and asset URLs make that test intentionally network-dependent.

## Policy

Submitted code is rejected with line numbers for `var` declarations, `eval` references, and `Function` constructor calls before anything executes. Runtime property descriptors protect runesm-owned globals even when code reaches them through aliases or reflection.

## Error shape

`SerializedError` (on `JudgeCaseResult.error`, `JudgeRunResult.error`, and `ReplResult.error`) always carries `name` and `message`, plus `stack` when the source error had one. `name` is the reliable discriminator; branch on it (`'PolicyViolation'`, `'UserSyntaxError'`, `'SpecifierResolutionError'`, `'TimeoutError'`, …) rather than parsing `message`. When the underlying error was one of this package's own structured error classes, its fields ride along too:

- `PolicyViolation` → `rule` (`PolicyRule`) and `line`
- `UserSyntaxError` → `line` and `column`
- `SpecifierResolutionError` → `kind` (`ResolutionFailureKind`) and `specifier`

These extra fields are optional and only present for the matching error kind — check `name` first, then read the fields that go with it.

## Advanced: composition primitives

`createRunesm` and `createReplSession` cover the supported way to run user code. The package also exports the lower-level pieces they're built from, for hosts that want to compose their own pipeline (for example: lint submitted code without executing it, or list the bare imports a snippet would need before running it — this is how the [playground](../../apps/playground) shows a dependency list before a run):

- `parseUserModule(code)` — parses into an acorn AST, throwing `UserSyntaxError` on invalid syntax.
- `checkPolicy(ast)` — returns the `PolicyViolation`s in a parsed module (see [Policy](#policy)).
- `collectBareSpecifiers(ast)` — lists the bare import specifiers a parsed module references.
- `resolveDependencies` / `resolveImportSpecifier` — resolve bare specifiers to CDN URLs, throwing `SpecifierResolutionError` on failure (see [Dependencies and autoInstall](#dependencies-and-autoinstall)).

These compose by chaining return values (`collectBareSpecifiers(parseUserModule(code))`) without ever needing to name the acorn `Node`/`Program` type. If you do want to type an intermediate AST value yourself, add `acorn` as a direct dependency — this package does not re-export its types.

## Workers and bundlers

`createRunesm` loads `worker-entry.mjs` and `execution-worker-entry.mjs` next to the main-thread module by default. Both scripts must be served from the website origin. A Content Security Policy must allow both through `worker-src`.

Bundlers that relocate assets should emit both workers and pass the execution-worker URL explicitly. For Vite:

```ts
import { adaptWorker, createRunesm } from 'runesm'
import RunesmExecutionWorkerUrl from './runesm-execution-worker?worker&url'
import RunesmWorker from './runesm-worker?worker'

const session = createRunesm({
  workerFactory: () => adaptWorker(new RunesmWorker()),
  executionWorkerUrl: RunesmExecutionWorkerUrl,
})
```

The two local entry files contain only these imports:

```ts
// runesm-worker.ts
import 'runesm/worker-entry'

// runesm-execution-worker.ts
import 'runesm/execution-worker-entry'
```

`workerUrl` is the lighter escape hatch when a URL to the coordinator entry is available. `executionWorkerUrl` identifies the child entry. When copying published assets without a bundler, keep both `.mjs` files together so the default relative URL resolves.

## Testing your integration

The package's own suite includes a real-browser harness ([`scripts/browser-test.ts`](./scripts/browser-test.ts), run with `bun`): it serves the built package, drives it in a headless browser, and exercises the real workers against esm.sh. The current compatibility gate covers Chromium and WebKit. Firefox is not yet part of the claimed matrix. `pnpm test` stays offline and deterministic with data-URL imports only.

## License

MIT
