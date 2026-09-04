# esmwell

[![CI](https://github.com/jkomyno/esmwell/actions/workflows/ci.yaml/badge.svg)](https://github.com/jkomyno/esmwell/actions/workflows/ci.yaml)
[![npm version](https://img.shields.io/npm/v/esmwell?color=blue)](https://npmjs.com/package/esmwell)
[![npm downloads](https://img.shields.io/npm/dm/esmwell?color=blue)](https://npm.chart.dev/esmwell)
[![install size](https://badgen.net/packagephobia/install/esmwell?color=blue)](https://packagephobia.com/result?p=esmwell)
[![license](https://img.shields.io/npm/l/esmwell?color=blue)](https://github.com/jkomyno/esmwell/blob/main/LICENSE)

Run unbundled ESM in the browser with hard timeouts, dependency resolution, and normalized results.

![esmwell playground running an Effect v4 program](https://raw.githubusercontent.com/jkomyno/esmwell/main/docs/media/playground.gif)

- ✅ **Judge, REPL, and test-workspace modes** from one small ESM-only package
- ✅ **Bare imports just work.** `import { z } from 'zod'` resolves through [esm.sh](https://esm.sh) at runtime, with no bundler and no install step
- ✅ **Infinite loops become results, not frozen tabs.** A hard timeout terminates the worker and returns a typed `TimeoutError`
- ✅ **Console output streams** while the submitted code is still running
- ✅ **TypeScript input** through a transform that uses your own `typescript` package
- ✅ **Real Vitest and Jest engines**, loaded lazily so judge and REPL users never pay for them
- ✅ **Small.** One runtime dependency ([acorn](https://github.com/acornjs/acorn)) and a CI-enforced 30 KB gzip budget

👉 [Compatibility reference](https://github.com/jkomyno/esmwell/blob/main/COMPATIBILITY.md) · [Recipes](https://github.com/jkomyno/esmwell/tree/main/docs/recipes) · [Playground source](https://github.com/jkomyno/esmwell/tree/main/apps/playground) · [Contributing](https://github.com/jkomyno/esmwell/blob/main/CONTRIBUTING.md)

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [REPL mode](#repl-mode)
- [TypeScript input](#typescript-input)
- [TypeScript editor kit](#typescript-editor-kit)
- [Vitest and Jest workspaces](#vitest-and-jest-workspaces)
- [API](#api)
- [Workers and bundlers](#workers-and-bundlers)
- [Execution model](#execution-model)
- [Errors and policy](#errors-and-policy)
- [Compatibility](#compatibility)
- [Recipes](#recipes)

## Install

```bash
npm install esmwell
# pnpm add esmwell · yarn add esmwell · bun add esmwell
```

The package ships ESM only (`.mjs`) and targets browsers. It loads two worker scripts next to the main module by default. If your bundler relocates assets, read [Workers and bundlers](#workers-and-bundlers) before the first run.

## Quick start

Judge mode runs a module once and checks its named exports against structured cases:

```ts
import { createEsmwell } from 'esmwell'

const session = createEsmwell({
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

Expected and actual values compare structurally: `NaN` equals `NaN`, `+0` and `-0` differ, `Map` and `Set` ignore insertion order, TypedArrays compare byte-wise, and prototypes must match. `RegExp` compares source and flags, boxed primitives compare their wrapped value, and `Error` compares class, `name`, `message`, and `cause`, never `stack`.

Console capture has a 65,536-character per-run budget, including per-call overhead. Long values and collections are previewed. When the budget runs out, one warning chunk is emitted and later calls are dropped.

## REPL mode

A Node-style persistent scope. Declarations, imports, and reassignments survive across inputs, and closures observe later changes:

```ts
import { createReplSession } from 'esmwell'

const repl = createReplSession({})

await repl.evaluate('let count = 0')
await repl.evaluate('count++')
const { value } = await repl.evaluate('count') // 1

await repl.evaluate('const get = () => count')
await repl.evaluate('count = 5')
const live = (await repl.evaluate('get()')).value // 5, a live binding

await repl.reset() // fresh scope
repl.close()
```

Each input's completion value (its final expression) comes back as `value`. Named exported declarations persist like ordinary REPL declarations, so an ESM module can seed the scope before interactive inputs. A local export list is accepted but adds no new binding. Re-exports and default-export expressions without a named function or class are rejected with a clear error.

The persistent scope is an internal object, so its declaration semantics deliberately differ from a JavaScript module:

- Re-declaring a name with `let` or `const` reassigns it instead of erroring. Both become scope assignments, so a later input can reassign an earlier `const`.
- Reading a name that was never declared reports `ReferenceError`, while `typeof someUndeclaredName` evaluates to `'undefined'`, matching a browser console.

## TypeScript input

Every session accepts a `transform` that rewrites submitted source on the main thread before it is posted to the worker: the judge module, each REPL input, and each test-workspace module. The worker only ever sees the returned text, so a transform changes what gets isolated, never how. Transforms run in submission order. A thrown error becomes an error result whose `error` keeps the thrown `name`, `message`, and `line`/`column` when the error exposes them.

`esmwell/typescript` ships a transform built on `ts.transpileModule` without depending on the compiler. You hand over the import, so the `.ts` path exists only where `typescript` is installed, and a bundler without it still builds:

```ts
import { createEsmwell } from 'esmwell'
import { typescriptTransform } from 'esmwell/typescript'

const session = createEsmwell({
  transform: typescriptTransform({ load: () => import('typescript') }),
})

await session.runJudge(`export const solve = (value: number): number => value * 2`, [
  { name: 'doubles', exportName: 'solve', args: [21], expected: 42 },
])
```

`transpileModule` strips types and compiles syntax one file at a time with `module: ESNext`, `target: ES2023`, and `verbatimModuleSyntax`. Pass `compilerOptions` to override. It never type-checks, so type errors run, while syntax errors come back as a `TypeScriptError` result with the diagnostic's line and column. If `load` rejects or resolves to something that is not the compiler, the run reports a `TypeScriptUnavailableError` and the next run retries the load.

The same hook takes any other compiler with the shape `(source, context) => string | Promise<string>`. `context.kind` is `'judge'`, `'repl'`, or `'test'` (with the module `id`).

## TypeScript editor kit

`esmwell/typescript-editor` is an opt-in declaration-acquisition kit for CodeMirror, Monaco, or a custom browser editor. It discovers bare imports in submitted source, resolves their exact npm versions, downloads bounded declaration archives from the npm registry, and follows package exports plus relative and transitive declaration imports. Source packages are acquired automatically; users do not run an install command or maintain a package manifest.

Like `esmwell/typescript`, this entrypoint does not import or bundle the compiler. Pass the structural `preProcessFile` capability from the TypeScript version already used by the editor:

```ts
import * as ts from 'typescript'
import { createTypeScriptModuleScanner, typeResolutionKey, TypeScriptTypeAcquirer } from 'esmwell/typescript-editor'

const scanner = createTypeScriptModuleScanner(ts)
const acquirer = new TypeScriptTypeAcquirer({ scanner })
const graph = await acquirer.acquire(`import { z } from 'zod@4'`)

const extraLibs = new Map(graph.files.map((file) => [file.fileName, file.content]))

const resolutions = new Map(
  graph.resolutions.map((resolution) => [
    typeResolutionKey(resolution.specifier, resolution.containingFilePrefix),
    resolution.fileName,
  ]),
)
```

`files` are virtual declaration files under `ESMWELL_TYPES_ROOT`. `resolutions` maps each source or declaration import to its exact virtual file; `containingFilePrefix` distinguishes imports made by transitive packages. `complete` is `false` when a request fails or a safety limit truncates the graph. Incomplete results and failed metadata/archive requests are retried, while successful metadata, archives, and graphs use bounded in-memory caches.

`createTypeScriptModuleScanner` also exposes `moduleSpecifiers(source)` and `isModuleSpecifierPosition(source, position)` for editor completion routing. `TypeScriptTypeAcquirer` accepts optional `fetch` and `fetchTimeoutMs` overrides for hosts that need a custom network boundary.

## Vitest and Jest workspaces

Run real, current Vitest or Jest engine packages over a virtual ESM project. Canonical local ids take precedence over npm packages, so test files can use imports such as `import { impl } from 'src/impl'` without a filesystem:

```ts
import { createTestSession } from 'esmwell'

const tests = createTestSession({
  workerUrl: '/assets/esmwell/test-worker-entry.mjs',
  serviceWorkerUrl: '/assets/esmwell/module-service-worker.mjs',
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

Test sessions default to `timeoutMs: 60000` because the same budget covers service-worker setup, the engine download, and the test run. Judge and REPL sessions keep the 5-second default.

For Jest, import the same globals from `@jest/globals`. `jest.fn` and `jest.spyOn` use the official `jest-mock` package. Both engines and their assertion libraries load lazily from esm.sh, so judge and REPL users do not pay their download cost. The browser test payload is a few megabytes uncompressed, so start the download when a user opens or runs a test playground, not during initial page load.

The virtual graph uses native browser ESM, including cycles, live bindings, relative imports, re-exports, and literal dynamic imports. Exact canonical ids under `src/` and `tests/` are treated as local. Missing ids produce an actionable workspace error instead of resolving an npm package with the same name.

### Hosting the test assets

Test mode needs the published `test-worker-entry.mjs` and `module-service-worker.mjs` files served from the website's origin and from the same directory. That directory becomes the service-worker scope. HTTPS is required outside localhost. Pass explicit URLs when a bundler relocates the files. A blob-built execution worker cannot participate in this mode. The service worker only answers esmwell's versioned virtual-module path beneath its scope and leaves other requests untouched.

Serve these assets from a dedicated directory so the registration can safely own its scope and update across deployments.

Each test run creates and terminates its own worker. A timeout therefore clears engine registration state and the virtual module graph before the next run.

### What the engines support

This is an ESM playground API backed by official engine components, not the Vitest or Jest Node CLI. It supports suites, tests, hooks, upstream assertions, Vitest `vi.fn`, Jest mock functions, `it.only`/`describe.only`, and normalized results.

Config files, plugins, watch mode, coverage, filesystem discovery, CJS, Node environments, and module mocking are not supported. Snapshots are in-memory for a single Vitest run. Jest assertion-count enforcement is unavailable because it depends on Jest's private environment adapter. A workspace that registers no tests is an error: a clean engine outcome with no registered tests becomes a `NoTestsError`, while an engine's own error details are preserved.

## API

### `createEsmwell(options?)` → `EsmwellSession`

| Method                             | Returns                   | Description                                                               |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| `runJudge(code, cases, handlers?)` | `Promise<JudgeRunResult>` | Runs `code` once and checks each `JudgeCase`. Runs serialize per session. |
| `close()`                          | `void`                    | Terminates the workers and invalidates the session.                       |

### `createReplSession(options?)` → `ReplSession`

| Method                       | Returns               | Description                                         |
| ---------------------------- | --------------------- | --------------------------------------------------- |
| `evaluate(input, handlers?)` | `Promise<ReplResult>` | Evaluates one input against the persistent scope.   |
| `reset()`                    | `Promise<void>`       | Starts a fresh scope in a fresh worker.             |
| `close()`                    | `void`                | Terminates the workers and invalidates the session. |

### `createTestSession(options?)` → `TestSession`

| Method                | Returns                  | Description                                                            |
| --------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `run(run, handlers?)` | `Promise<TestRunResult>` | Runs a `TestRun` (`engine`, `modules`, `testFiles`) in a fresh worker. |
| `close()`             | `void`                   | Prevents future runs. An in-flight run still settles.                  |

### Options

`EsmwellOptions` is shared by all three factories. `TestSessionOptions` extends it.

| Option               | Type                          | Default                               | Description                                                                                                              |
| -------------------- | ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `deps`               | `Record<string, string>`      | `{}`                                  | Package name to pinned version for bare-import resolution. Inline versions in the source take precedence.                |
| `autoInstall`        | `boolean`                     | `true`                                | Resolve unpinned bare imports to the CDN's latest. When `false`, an unpinned bare import is an error.                    |
| `timeoutMs`          | `number`                      | `5000` (`60000` for test sessions)    | Hard timeout per run. Exceeding it terminates the execution worker and returns a `TimeoutError` result.                  |
| `transform`          | `SourceTransform`             | none                                  | Rewrites submitted source on the main thread before it reaches the worker. See [TypeScript input](#typescript-input).    |
| `workerUrl`          | `string \| URL`               | `worker-entry.mjs` beside the module  | URL of the coordinator entry (or `test-worker-entry.mjs` for test sessions).                                             |
| `executionWorkerUrl` | `string \| URL`               | `execution-worker-entry.mjs`          | Same-origin child worker that owns submitted judge and REPL code.                                                        |
| `workerFactory`      | `(url: string) => WorkerLike` | `new Worker(url, { type: 'module' })` | Builds the workers. Wrap a bundler-emitted worker with `adaptWorker`. See [Workers and bundlers](#workers-and-bundlers). |
| `serviceWorkerUrl`   | `string \| URL`               | `module-service-worker.mjs`           | Test sessions only. Same-origin service worker backing the virtual module graph.                                         |

`handlers` on every run method is `{ onConsoleChunk?: (chunk: ConsoleChunk) => void }`. Chunks stream as the code runs and are also collected on the result.

### Results

Every result carries `status`, `console` (the collected `ConsoleChunk`s), `dependencies` (`{ specifier, name, version, url }[]`), `durationMs`, and an optional `error` of type `SerializedError`.

| Result           | Extra fields                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `JudgeRunResult` | `cases: JudgeCaseResult[]`, each with `status`, `actual`, `expected`, and `error`                          |
| `ReplResult`     | `value`, the completion value of the input                                                                 |
| `TestRunResult`  | `engine: { name, version, packages }` and `tests: TestCaseResult[]` with `pass`, `fail`, `skip`, or `todo` |

### Subpath exports

| Import                           | Contents                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `esmwell`                        | The three session factories, `adaptWorker`, the composition primitives, and every public type                                       |
| `esmwell/typescript`             | `typescriptTransform` and `TypeScriptUnavailableError`                                                                              |
| `esmwell/typescript-editor`      | Editor-neutral import scanning and automatic exact-version npm declaration acquisition                                              |
| `esmwell/utils`                  | `isBareSpecifier`, `formatConsoleArguments`, `serializeValue`, `createWorkerRpc`, and `serveWorkerRpc`. Pulls in none of the runner |
| `esmwell/worker-entry`           | Coordinator worker entry for judge and REPL sessions                                                                                |
| `esmwell/execution-worker-entry` | Child worker entry that runs submitted judge and REPL code                                                                          |
| `esmwell/test-worker-entry`      | Worker entry for test sessions                                                                                                      |
| `esmwell/module-service-worker`  | Service worker backing the test-session module graph                                                                                |

## Workers and bundlers

`createEsmwell` and `createReplSession` load `worker-entry.mjs` and `execution-worker-entry.mjs` next to the main-thread module by default. Both scripts must be served from the website origin, and a Content Security Policy must allow both through `worker-src`.

Bundlers that relocate assets should emit both workers and pass the execution-worker URL explicitly. For Vite:

```ts
import { adaptWorker, createEsmwell } from 'esmwell'
import EsmwellExecutionWorkerUrl from './esmwell-execution-worker?worker&url'
import EsmwellWorker from './esmwell-worker?worker'

const session = createEsmwell({
  workerFactory: () => adaptWorker(new EsmwellWorker()),
  executionWorkerUrl: EsmwellExecutionWorkerUrl,
})
```

The two local entry files contain only these imports:

```ts
// esmwell-worker.ts
import 'esmwell/worker-entry'

// esmwell-execution-worker.ts
import 'esmwell/execution-worker-entry'
```

`workerUrl` is the lighter escape hatch when a URL to the coordinator entry is available. `executionWorkerUrl` identifies the child entry. When copying published assets without a bundler, keep both `.mjs` files together so the default relative URL resolves. Test sessions need `test-worker-entry.mjs` and `module-service-worker.mjs` instead, as described in [Hosting the test assets](#hosting-the-test-assets).

## Execution model

Judge and REPL sessions use two worker levels:

```text
page → coordinator worker → execution worker
```

The coordinator never evaluates submitted code. It owns the deadline and terminates the execution worker on timeout or fatal failure. Every judge run starts in a fresh execution worker. A REPL keeps one worker so declarations persist, then discards it on reset, timeout, or fatal failure.

Test workspaces use one fresh page-owned worker per run. Their virtual module graph is backed by a scoped service worker, and direct ownership keeps that graph portable across Chromium and WebKit.

Bindings installed by esmwell, including `globalThis.process`, `globalThis.console`, and test-engine bridges, are non-writable and non-configurable. Submitted code cannot replace or delete them. Their intended contents can still be mutable, so `process.env.KEY = 'value'` remains supported.

### Not a security sandbox

Worker isolation makes execution disposable and lets the host recover from synchronous infinite loops. It does not turn a browser worker into a process, VM, V8 isolate, or workerd security boundary. Submitted code retains browser worker capabilities allowed by the page, including same-origin and network access unless the host restricts them.

### Dependencies and `autoInstall`

- Bare specifiers in `import`, `export … from`, and literal dynamic `import()` rewrite to `https://esm.sh/{name}@{version}` at runtime. No manifest, no bundler.
- `deps` pins exact versions. An inline version such as `effect@beta/Option` takes precedence. `autoInstall: true` (the default) resolves everything else to the CDN's latest.
- `autoInstall: false` makes an unpinned bare import an error: `could not resolve 'x' — check the package name or add it to deps`.
- Absolute URLs pass through untouched. Relative specifiers error, because user code runs from an in-memory URL.
- `process` and `node:process` resolve to the worker's browser process object. Other `node:*` imports fail fast with module-specific pointers to browser alternatives (`node:crypto` to `globalThis.crypto`, `node:http` to `fetch()`, and so on).
- Every result surfaces the resolved dependency list (`name`, `version`, `url`) so hosts can display what a run actually used.

## Errors and policy

Submitted code is rejected with line numbers for `var` declarations, `eval` references, and `Function` constructor calls before anything executes. Runtime property descriptors protect esmwell-owned globals even when code reaches them through aliases or reflection.

`SerializedError` (on `JudgeCaseResult.error`, `JudgeRunResult.error`, `ReplResult.error`, and each `TestCaseResult.errors` entry) always carries `name` and `message`, plus `stack` when the source error had one. `name` is the reliable discriminator. Branch on it rather than parsing `message`:

| `name`                       | Extra fields                                  | Cause                                                   |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `PolicyViolation`            | `rule` (`PolicyRule`), `line`                 | `var`, `eval`, or `Function` construction in the source |
| `UserSyntaxError`            | `line`, `column`                              | The source did not parse as an ES2023 module            |
| `SpecifierResolutionError`   | `kind` (`ResolutionFailureKind`), `specifier` | A bare or `node:*` import could not be resolved         |
| `TimeoutError`               |                                               | The run exceeded `timeoutMs`                            |
| `TypeScriptError`            | `line`, `column`                              | `esmwell/typescript` hit a syntax diagnostic            |
| `TypeScriptUnavailableError` |                                               | The `load` callback did not yield the compiler          |
| `NoTestsError`               |                                               | A test workspace registered no tests                    |

Extra fields are present only for the matching error kind. Check `name` first, then read the fields that go with it.

## Compatibility

`esmwell` executes ES2023 modules inside browser workers, so most ECMAScript support comes straight from the host browser. The release gate runs in Chrome. WebKit is probed manually and Firefox is not covered.

Things worth knowing before you ship:

- `eval` references and `Function` construction are rejected by policy before execution.
- `Temporal`, `SuppressedError`, `Float16Array`, `DisposableStack`, `AsyncDisposableStack`, and the `Iterator` helper class are Chromium-only in the tested backends. Polyfill them from esm.sh when both matter. The parser does not accept post-ES2023 `using` syntax either way.
- `SharedArrayBuffer` and `Atomics` need cross-origin isolation headers from the host page.
- `node:*` imports fail fast with pointers to browser alternatives. Only `node:process` has a partial contract.
- Requests and results cross a structured-clone boundary, so functions, symbols, and proxies cannot be passed or returned directly.
- CommonJS and `require()` are out of scope. Use [almostnode](https://github.com/macaly/almostnode) when Node-style execution is a requirement.

👉 **[COMPATIBILITY.md](https://github.com/jkomyno/esmwell/blob/main/COMPATIBILITY.md)** is the full reference: every entry in MDN's standard built-ins index, the `node:process` contract, the Vitest/Jest workspace boundaries, and an FAQ.

### Choosing the right tool

| Tool                                                        | Best for                                                                                | Execution model                                                                                             | Packages and environment                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **esmwell**                                                 | Running unbundled ESM in a page: snippets, persistent REPLs, and Vitest/Jest workspaces | Executes real ESM in browser workers with hard timeout recovery; worker isolation is not a security sandbox | Resolves bare imports through esm.sh; browser APIs, no virtual filesystem or general Node.js runtime              |
| [**callscript**](https://github.com/vercel-labs/callscript) | AI-authored tool workflows that need bounded, inspectable, resumable plans              | Parses a constrained JavaScript surface into inert JSON; only host-provided tools execute                   | Mounts tools through plain adapters, the AI SDK, or MCP; it does not execute arbitrary JavaScript or npm packages |
| [**almostnode**](https://github.com/macaly/almostnode)      | Node-style browser development environments and playgrounds                             | Executes code on the main thread, in a worker, or through its separately deployed cross-origin sandbox      | Provides a virtual filesystem, Node.js API shims, npm installation, CLIs, and Vite/Next.js dev servers            |

`callscript` and esmwell both parse JavaScript with Acorn and validate it before work begins, but only esmwell goes on to execute the submitted module. `almostnode` is the closer runtime alternative: choose it when Node.js compatibility is the requirement, and esmwell when ESM-native execution, a persistent REPL, or a focused test-workspace API is the requirement.

## Recipes

Longer, verified examples live in the repository:

- [**Effect v4 beta**](https://github.com/jkomyno/esmwell/blob/main/docs/recipes/effect.md): the program from the demo above, the `beta` tag, `process` expectations, and the ledger of Effect entrypoints that need host services a browser worker cannot provide.
- [**WebAssembly packages**](https://github.com/jkomyno/esmwell/blob/main/docs/recipes/webassembly.md): rendering a PNG with `@cf-wasm/og`, `resvg`, and `satori` from the browser worker.
- [**Composition primitives**](https://github.com/jkomyno/esmwell/blob/main/docs/recipes/composition.md): `parseUserModule`, `checkPolicy`, `collectBareSpecifiers`, `resolveDependencies`, and the `esmwell/utils` helpers for hosts that build their own pipeline.

The shortest Effect example, using the `beta` tag because esm.sh's unqualified `latest` is Effect v3:

```ts
const session = createEsmwell({ autoInstall: false, timeoutMs: 30_000 })

const result = await session.runJudge(
  `import * as Effect from 'effect@beta/Effect'
   export const solve = (name) => Effect.runPromise(Effect.succeed(\`hello, \${name}\`))`,
  [{ name: 'greets', exportName: 'solve', args: ['esmwell'], expected: 'hello, esmwell' }],
)
```

## License

[MIT](https://github.com/jkomyno/esmwell/blob/main/LICENSE) © [Alberto Schiabel](https://github.com/jkomyno)
