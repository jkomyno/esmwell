# runesm compatibility

`runesm` executes ES2023 modules inside browser workers. It does not replace the browser's JavaScript engine, so most ECMAScript support comes directly from the host browser. `runesm` adds a small policy layer, an ESM resolver, worker lifecycle management, and result normalization.

This reference answers two separate questions.

1. Which standard ECMAScript APIs can submitted code reach?
2. Which package and runtime assumptions fit runesm's browser-first model?

## How to read the tables

| Mark | Meaning                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------- |
| ✅   | Available in both tested browser backends through runesm's child execution worker                        |
| ⚠️   | Available with a policy restriction, browser-version condition, host requirement, or deprecation warning |
| ❌   | Outside runesm's contract or unavailable in both tested backends                                         |

The ECMAScript inventory follows every entry in MDN's [Standard built-in objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects) index as checked on August 28, 2026. It records API entry-point availability, not a replacement for MDN's per-method browser data. New methods still depend on the user's browser.

The probe ran through the built package, coordinator worker, and child execution worker in:

- Chrome 151.0.7922.174
- WKWebView on macOS 14.4.1, reporting AppleWebKit 605.1.15

The hosted release gate runs Chrome. The WebKit rows record this manual snapshot and are not a release gate.

The partial `node:process` contract is also covered by deterministic facade tests and real-browser tests for its exact exports, identity, mutable contents, scheduling, unsupported operations, and judge/REPL lifecycle.

Firefox is not part of the compatibility snapshot. The parser accepts ES2023 module syntax. A newer global may still work when the browser supplies it, even when its related syntax is newer than ES2023.

## ECMAScript built-ins

### Value properties

| API          | Status | Notes                                     |
| ------------ | :----: | ----------------------------------------- |
| `globalThis` |   ✅   | Refers to the child worker global object. |
| `Infinity`   |   ✅   | Native browser value.                     |
| `NaN`        |   ✅   | Native browser value.                     |
| `undefined`  |   ✅   | Native browser value.                     |

### Function properties

| API                    | Status | Notes                                                                                                                                      |
| ---------------------- | :----: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `eval()`               |   ❌   | Any submitted-code reference to the `eval` identifier is rejected before execution. Property names such as `object.eval` are not rejected. |
| `isFinite()`           |   ✅   | Native browser function. Prefer `Number.isFinite()` when coercion is unwanted.                                                             |
| `isNaN()`              |   ✅   | Native browser function. Prefer `Number.isNaN()` when coercion is unwanted.                                                                |
| `parseFloat()`         |   ✅   | Native browser function.                                                                                                                   |
| `parseInt()`           |   ✅   | Native browser function.                                                                                                                   |
| `decodeURI()`          |   ✅   | Native browser function.                                                                                                                   |
| `decodeURIComponent()` |   ✅   | Native browser function.                                                                                                                   |
| `encodeURI()`          |   ✅   | Native browser function.                                                                                                                   |
| `encodeURIComponent()` |   ✅   | Native browser function.                                                                                                                   |
| `escape()`             |   ⚠️   | Present in both backends, but deprecated. Use URI encoding APIs for new code.                                                              |
| `unescape()`           |   ⚠️   | Present in both backends, but deprecated. Use URI decoding APIs for new code.                                                              |

### Fundamental objects

| API        | Status | Notes                                                                                                                                                                        |
| ---------- | :----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Object`   |   ✅   | Native constructor and methods.                                                                                                                                              |
| `Function` |   ⚠️   | Ordinary functions work. Direct `Function(...)`, `new Function(...)`, tagged calls, and direct `.call()`, `.apply()`, or `.bind()` constructor calls are rejected by policy. |
| `Boolean`  |   ✅   | Native constructor and primitive wrapper.                                                                                                                                    |
| `Symbol`   |   ✅   | Native symbols work inside submitted code. Symbols are not structured-cloneable across the worker boundary.                                                                  |

### Error objects

| API               | Status | Notes                                                                                                           |
| ----------------- | :----: | --------------------------------------------------------------------------------------------------------------- |
| `Error`           |   ✅   | Native error type. Serialized results preserve `name`, `message`, and an available `stack`.                     |
| `AggregateError`  |   ✅   | Available in both backends.                                                                                     |
| `EvalError`       |   ✅   | The constructor exists even though `eval` references are rejected.                                              |
| `RangeError`      |   ✅   | Available in both backends.                                                                                     |
| `ReferenceError`  |   ✅   | Available in both backends.                                                                                     |
| `SuppressedError` |   ⚠️   | Available in Chrome 151, absent in the tested WebKit.                                                           |
| `SyntaxError`     |   ✅   | Available in both backends. Parse failures become runesm `UserSyntaxError` results with line and column fields. |
| `TypeError`       |   ✅   | Available in both backends.                                                                                     |
| `URIError`        |   ✅   | Available in both backends.                                                                                     |
| `InternalError`   |   ❌   | Absent in both tested backends. This is primarily a Firefox-specific error type.                                |

### Numbers and dates

| API        | Status | Notes                                                                                                |
| ---------- | :----: | ---------------------------------------------------------------------------------------------------- |
| `Number`   |   ✅   | Native numbers and static methods.                                                                   |
| `BigInt`   |   ✅   | Native big integers. Values work in the child worker and can cross the structured-clone boundary.    |
| `Math`     |   ✅   | Native namespace.                                                                                    |
| `Date`     |   ✅   | Native constructor. Time zone data comes from the browser.                                           |
| `Temporal` |   ⚠️   | Available in Chrome 151, absent in the tested WebKit. Use an ESM polyfill when both backends matter. |

### Text processing

| API      | Status | Notes                                                                 |
| -------- | :----: | --------------------------------------------------------------------- |
| `String` |   ✅   | Native strings and methods.                                           |
| `RegExp` |   ✅   | Native regular expressions. Judge equality compares source and flags. |

### Indexed collections

| API                 | Status | Notes                                                                                                                            |
| ------------------- | :----: | -------------------------------------------------------------------------------------------------------------------------------- |
| `Array`             |   ✅   | Native arrays.                                                                                                                   |
| `TypedArray`        |   ✅   | The abstract superclass is available through concrete typed-array constructors. It has no global `TypedArray` binding by design. |
| `Int8Array`         |   ✅   | Available in both backends.                                                                                                      |
| `Uint8Array`        |   ✅   | Available in both backends.                                                                                                      |
| `Uint8ClampedArray` |   ✅   | Available in both backends.                                                                                                      |
| `Int16Array`        |   ✅   | Available in both backends.                                                                                                      |
| `Uint16Array`       |   ✅   | Available in both backends.                                                                                                      |
| `Int32Array`        |   ✅   | Available in both backends.                                                                                                      |
| `Uint32Array`       |   ✅   | Available in both backends.                                                                                                      |
| `BigInt64Array`     |   ✅   | Available in both backends.                                                                                                      |
| `BigUint64Array`    |   ✅   | Available in both backends.                                                                                                      |
| `Float16Array`      |   ⚠️   | Available in Chrome 151, absent in the tested WebKit.                                                                            |
| `Float32Array`      |   ✅   | Available in both backends.                                                                                                      |
| `Float64Array`      |   ✅   | Available in both backends.                                                                                                      |

### Keyed collections

| API       | Status | Notes                                                                       |
| --------- | :----: | --------------------------------------------------------------------------- |
| `Map`     |   ✅   | Native collection. Judge equality ignores insertion order.                  |
| `Set`     |   ✅   | Native collection. Judge equality ignores insertion order.                  |
| `WeakMap` |   ✅   | Available in both backends. Its entries cannot be enumerated or serialized. |
| `WeakSet` |   ✅   | Available in both backends. Its entries cannot be enumerated or serialized. |

### Structured data

| API                 | Status | Notes                                                                                                                            |
| ------------------- | :----: | -------------------------------------------------------------------------------------------------------------------------------- |
| `ArrayBuffer`       |   ✅   | Available in both backends.                                                                                                      |
| `SharedArrayBuffer` |   ⚠️   | Not exposed by the default harness because it is not cross-origin isolated. A host must send the required isolation headers.     |
| `DataView`          |   ✅   | Available in both backends.                                                                                                      |
| `Atomics`           |   ⚠️   | The namespace exists in both backends. Useful shared-memory operations also need `SharedArrayBuffer` and cross-origin isolation. |
| `JSON`              |   ✅   | Native namespace.                                                                                                                |

### Managing memory

| API                    | Status | Notes                                                                            |
| ---------------------- | :----: | -------------------------------------------------------------------------------- |
| `WeakRef`              |   ✅   | Available in both backends. Collection timing is intentionally nondeterministic. |
| `FinalizationRegistry` |   ✅   | Available in both backends. Cleanup timing is intentionally nondeterministic.    |

### Control abstraction objects

| API                      | Status | Notes                                                                                                                          |
| ------------------------ | :----: | ------------------------------------------------------------------------------------------------------------------------------ |
| `Iterator`               |   ⚠️   | The global iterator-helper class is available in Chrome 151 and absent in the tested WebKit. Ordinary iteration works in both. |
| `AsyncIterator`          |   ✅   | The hidden prototype and async iterator protocol work in both backends. MDN notes that this is not yet a global binding.       |
| `Promise`                |   ✅   | Native promises and async functions.                                                                                           |
| `GeneratorFunction`      |   ✅   | Generator functions work. Their constructor is reachable through the prototype chain rather than a global binding.             |
| `AsyncGeneratorFunction` |   ✅   | Async generator functions work. Their constructor is not a global binding.                                                     |
| `Generator`              |   ✅   | Generator objects and iteration work. `Generator` is not a global binding.                                                     |
| `AsyncGenerator`         |   ✅   | Async generator objects and `for await...of` work. `AsyncGenerator` is not a global binding.                                   |
| `AsyncFunction`          |   ✅   | Async functions work. Their constructor is not a global binding.                                                               |
| `DisposableStack`        |   ⚠️   | Available in Chrome 151, absent in the tested WebKit. The parser does not accept post-ES2023 `using` syntax.                   |
| `AsyncDisposableStack`   |   ⚠️   | Available in Chrome 151, absent in the tested WebKit. The parser does not accept post-ES2023 `await using` syntax.             |

### Reflection

| API       | Status | Notes                                                                                                |
| --------- | :----: | ---------------------------------------------------------------------------------------------------- |
| `Reflect` |   ✅   | Native namespace. Runtime-owned globals remain non-writable and non-configurable through reflection. |
| `Proxy`   |   ✅   | Native constructor. Proxy values are not structured-cloneable across the worker boundary.            |

### Internationalization

| API                       | Status | Notes                                                              |
| ------------------------- | :----: | ------------------------------------------------------------------ |
| `Intl`                    |   ✅   | Native namespace. Locale and time zone data come from the browser. |
| `Intl.Collator`           |   ✅   | Available in both backends.                                        |
| `Intl.DateTimeFormat`     |   ✅   | Available in both backends.                                        |
| `Intl.DisplayNames`       |   ✅   | Available in both backends.                                        |
| `Intl.DurationFormat`     |   ✅   | Available in both backends.                                        |
| `Intl.ListFormat`         |   ✅   | Available in both backends.                                        |
| `Intl.Locale`             |   ✅   | Available in both backends.                                        |
| `Intl.NumberFormat`       |   ✅   | Available in both backends.                                        |
| `Intl.PluralRules`        |   ✅   | Available in both backends.                                        |
| `Intl.RelativeTimeFormat` |   ✅   | Available in both backends.                                        |
| `Intl.Segmenter`          |   ✅   | Available in both backends.                                        |

## Packages and workloads that fit

`runesm` works best with JavaScript packages that publish ESM or a browser-compatible entry point. esm.sh may convert CommonJS inside a dependency graph, but submitted modules remain ESM.

| Workload                     | Status | Verified examples                                                                                                                                                                                                                                     |
| ---------------------------- | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESM packages from esm.sh     |   ✅   | `is-even` and Zod 4 imports resolve and execute in browser workers.                                                                                                                                                                                   |
| Effect v4                    |   ✅   | The browser suite imports all 156 entry points in its `effect@beta` probe. It also runs Schema decoding, `Effect.runFork`, scoped `Effect.acquireRelease`, `ConfigProvider.fromEnv`, `Schema.File`, MessagePack, `Path.layer`, and `FetchHttpClient`. |
| Vitest workspaces            |   ✅   | The browser suite runs current official `vitest`, `@vitest/runner`, and `@vitest/expect` packages with local modules, assertions, and focused tests. The adapter also exposes hooks, `vi.fn`, and in-memory snapshots.                                |
| Jest workspaces              |   ✅   | The browser suite runs current official `jest-circus`, `expect`, and `jest-mock` packages with local modules, assertions, and focused tests. The adapter also exposes hooks, `jest.fn`, and `jest.spyOn`.                                             |
| Native ESM graphs            |   ✅   | Test workspaces cover cycles, live bindings, relative imports, re-exports, exact local module ids, and literal dynamic imports.                                                                                                                       |
| Browser WebAssembly packages |   ✅   | The suite fetches and initializes `@cf-wasm/og`, `@cf-wasm/resvg`, and `@cf-wasm/satori`, then checks the generated PNG signature.                                                                                                                    |
| Worker Web APIs              |   ✅   | The browser suite exercises `fetch`, `File`, timers, `structuredClone`, and `WebAssembly`. Other worker APIs come from the host browser. Network access still follows CORS and Content Security Policy rules.                                         |

### Effect example

Pin the `beta` tag because the unqualified `effect` latest tag may point at a different major version.

```ts
import { createRunesm } from 'runesm'

const session = createRunesm({ autoInstall: false, timeoutMs: 30_000 })

const result = await session.runJudge(
  `import * as Effect from 'effect@beta/Effect'
   import * as Schema from 'effect@beta/Schema'

   const Input = Schema.Struct({ value: Schema.Number })

   export const solve = (input) => Effect.runSync(
     Effect.sync(() => Schema.decodeUnknownSync(Input)(input).value * 2),
   )`,
  [{ name: 'Effect and Schema', exportName: 'solve', args: [{ value: 21 }], expected: 42 }],
)

session.close()
```

### Vitest example

Test workspaces need the published worker and service-worker assets served from the same origin.

```ts
import { createTestSession } from 'runesm'

const tests = createTestSession({
  workerUrl: '/assets/runesm/test-worker-entry.mjs',
  serviceWorkerUrl: '/assets/runesm/module-service-worker.mjs',
  deps: { zod: '4' },
  autoInstall: false,
})

const result = await tests.run({
  engine: 'vitest',
  modules: {
    'src/double': `
      import { z } from 'zod'
      export const double = (value) => z.number().parse(value) * 2
    `,
    'tests/double.test': `
      import { expect, it } from 'vitest'
      import { double } from 'src/double'
      it('runs a local ESM module', () => expect(double(21)).toBe(42))
    `,
  },
  testFiles: ['tests/double.test'],
})

tests.close()
```

## Node.js 24 LTS built-in module coverage

Compared with [Node.js 24.20.0](https://nodejs.org/download/release/v24.20.0/docs/api/process.html), runesm has no completely supported `node:*` module. Its only partial module is `node:process`, which is also available through the bare `process` specifier. Every other `node:*` import is rejected before module evaluation and is omitted here.

| Node built-in                          | Support    | What runesm provides                                                                                                                                                                                                       | Difference from Node.js 24 LTS                                                                                                               |
| -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:process` and the `process` alias | ⚠️ Partial | One frozen, browser-identified facade shared by the default import and `globalThis.process`. It provides a small export set for environment reads, virtual paths, microtask scheduling, and dependency platform detection. | It does not represent an operating-system process, Node event loop, command invocation, standard I/O channel, IPC channel, or signal target. |

### `node:process` differences

| Surface                               | runesm behavior                                                                                                                                                                                                                                       | Node.js 24 LTS behavior                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Imports and identity                  | `node:process`, `process`, the default export, the extra named `process` export, and `globalThis.process` refer to the same facade.                                                                                                                   | `node:process` and `process` expose the Node process object. Node provides a default export, but no named `process` export.                                                          |
| Named exports                         | `browser`, `title`, `env`, `argv`, `version`, `versions`, `platform`, `cwd`, `chdir`, and `nextTick`.                                                                                                                                                 | Exposes module-level process properties and functions as named exports. Event-emitter methods remain on the default process object. Node does not provide runesm's `browser` marker. |
| `browser`                             | Always `true`. This lets browser-aware dependencies reject Node-only paths.                                                                                                                                                                           | Not part of the Node.js process API.                                                                                                                                                 |
| `env`                                 | Starts as an empty mutable object. It contains no host environment variables. Assigned JavaScript values are kept as written.                                                                                                                         | Starts from the process environment. Assigned values are converted to strings, although implicit conversion is deprecated.                                                           |
| `argv`                                | Starts as an empty mutable array. runesm has no command line.                                                                                                                                                                                         | Contains the Node executable path, program entry point, and supplied arguments.                                                                                                      |
| `cwd()`                               | Always returns `/`.                                                                                                                                                                                                                                   | Returns the process's current operating-system directory.                                                                                                                            |
| `chdir(directory)`                    | Always throws an actionable unsupported-operation error.                                                                                                                                                                                              | Changes the current operating-system directory when permitted.                                                                                                                       |
| `nextTick(callback, ...args)`         | Delegates to `queueMicrotask()` and forwards the callback arguments. It does not reproduce Node's separate next-tick queue.                                                                                                                           | Uses Node's next-tick queue, which has its own event-loop ordering. Node 24 marks this API as legacy.                                                                                |
| Event methods                         | `on`, `once`, `off`, `addListener`, and `removeListener` return the facade without registering anything. `emit` always returns `false`.                                                                                                               | The process object is an `EventEmitter` with lifecycle, rejection, exception, warning, IPC, worker, and signal events.                                                               |
| `title`                               | Fixed to `browser` because the facade is frozen.                                                                                                                                                                                                      | Starts from the executable name and can be assigned, subject to platform-specific limits.                                                                                            |
| `version`, `versions`, and `platform` | `version` is an empty string, `versions` starts empty, and `platform` is `undefined`. In particular, `versions.node` is absent.                                                                                                                       | Reports the Node release, dependency versions, and operating-system platform.                                                                                                        |
| Remaining process API                 | Absent. This includes process control, IDs, architecture, executable paths, standard I/O, IPC, signals, permissions, resource and memory statistics, reports, source-map controls, user and group IDs, `getBuiltinModule()`, and `.env` file loading. | Available according to the host platform and the Node.js 24 process contract.                                                                                                        |

## Unsupported and conditional behavior

### Language and module boundaries

| Boundary                            | Status | Exact behavior                                                                                                                                                                                                                                         |
| ----------------------------------- | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CommonJS user code                  |   ❌   | `require`, `module.exports`, `exports`, and `.cjs` execution are explicitly out of scope. Use [almostnode](https://github.com/macaly/almostnode) when a browser project needs a CommonJS runtime, virtual filesystem, or Node-style package execution. |
| ESM-to-CJS runtime transforms       |   ❌   | runesm never converts submitted ESM to CommonJS. esm.sh may convert a dependency's published CommonJS internals before serving browser ESM.                                                                                                            |
| TypeScript, TSX, and JSX source     |   ❌   | runesm itself accepts JavaScript and does not ship a compiler. The private playground's `.ts` mode compiles TypeScript in a separate browser worker before submitting the emitted module; TSX and JSX remain unsupported there.                        |
| Syntax newer than ES2023            |   ❌   | The Acorn parser is fixed to ES2023. This includes `using` and `await using`, even when a browser exposes disposal objects.                                                                                                                            |
| `var` declarations                  |   ❌   | Rejected before execution. Use `let` or `const`.                                                                                                                                                                                                       |
| `eval` references                   |   ❌   | Rejected before execution.                                                                                                                                                                                                                             |
| Direct `Function` constructor calls |   ❌   | Direct calls, construction, tags, and direct `.call()`, `.apply()`, or `.bind()` constructor invocations are rejected. This policy is a code-quality gate, not a security claim.                                                                       |
| Judge and REPL relative imports     |   ❌   | These modules start from in-memory URLs, so `./x`, `../x`, root-relative, and import-map specifiers are rejected. Use a bare package or absolute URL.                                                                                                  |
| Computed dynamic imports            |   ⚠️   | Only literal `import('specifier')` calls are rewritten and reported. A computed import passes to the browser unchanged and needs a browser-resolvable absolute URL.                                                                                    |
| REPL `export` statements            |   ⚠️   | Named exported declarations persist on the REPL scope, and local export lists are accepted without adding bindings. Re-exports and default-export expressions without a named function or class are rejected.                                          |

### Browser and Node.js boundaries

| Boundary                           | Status | Exact behavior                                                                                                                                                        |
| ---------------------------------- | :----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node globals                       |   ❌   | `Buffer`, `global`, `__dirname`, `__filename`, and Node's full process behavior are not provided.                                                                     |
| Node-API and native `.node` addons |   ❌   | Browser workers cannot load native binaries. Choose a browser or WebAssembly build.                                                                                   |
| DOM APIs                           |   ❌   | Submitted code runs in a worker. `window`, `document`, DOM nodes, and synchronous page access are unavailable. Pass structured data or build an explicit host bridge. |
| Host network policy                |   ⚠️   | `fetch`, WebSocket, and CDN imports follow browser CORS, Content Security Policy, permissions, and connectivity. runesm does not bypass them.                         |
| Shared memory                      |   ⚠️   | `SharedArrayBuffer` needs a cross-origin-isolated host page with the required COOP and COEP headers.                                                                  |
| Security isolation                 |   ❌   | Same-origin workers provide termination and fresh realms, not hostile-code containment. Submitted code keeps the worker capabilities granted by the host.             |

### Test-workspace boundaries

| Boundary                 | Status | Exact behavior                                                                                                                                                  |
| ------------------------ | :----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest or Jest CLI       |   ❌   | runesm loads selected official engine components. It does not run either Node CLI.                                                                              |
| Config files and plugins |   ❌   | `vitest.config.*`, Jest config, Vite plugins, setup discovery, and custom runners are not loaded.                                                               |
| Watch mode and coverage  |   ❌   | Each call is one finite run in a fresh worker. Coverage instrumentation and watch processes are absent.                                                         |
| Filesystem discovery     |   ❌   | The host supplies `modules` and `testFiles` explicitly. There is no globbing or disk scan.                                                                      |
| Node test environments   |   ❌   | Tests run in a browser worker, not `node`, `jsdom`, or a custom environment.                                                                                    |
| CommonJS tests           |   ❌   | Test modules and local source modules must be ESM JavaScript.                                                                                                   |
| Module mocking           |   ❌   | `vi.mock`, `jest.mock`, and loader-level module replacement are not supported. Function mocks and spies are supported.                                          |
| Persistent snapshots     |   ⚠️   | Vitest snapshots live in memory for one run and are returned in the result. runesm does not read or write snapshot files.                                       |
| Jest assertion counts    |   ❌   | `expect.assertions()` and `expect.hasAssertions()` cannot be enforced without Jest's private environment adapter.                                               |
| Empty test workspaces    |   ❌   | A run that registers no tests returns an error instead of a passing result.                                                                                     |
| Service-worker hosting   |   ⚠️   | Test mode needs HTTPS outside localhost. Both published test assets must share an origin and directory so the service-worker scope can serve the virtual graph. |

### Result and REPL boundaries

| Boundary                             | Status | Exact behavior                                                                                                                                          |
| ------------------------------------ | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured-clone transport           |   ⚠️   | Requests must not contain functions, symbols, or proxies. Non-cloneable returned values fall back to serializable previews or an error result.          |
| REPL declaration semantics           |   ⚠️   | Top-level `let` and `const` become assignments on the persistent scope. Redeclaration and later reassignment therefore differ from a JavaScript module. |
| REPL missing names                   |   ✅   | Reading a name never declared in the REPL reports `ReferenceError`; direct `typeof name` evaluates to `'undefined'`.                                    |
| REPL lifetime                        |   ⚠️   | State persists only until reset, timeout, fatal failure, session close, or worker replacement.                                                          |
| Durable storage and offline packages |   ❌   | There is no virtual filesystem, registry client, package cache, or offline dependency graph. Bare imports depend on esm.sh.                             |
| Servers, sockets, and CLI processes  |   ❌   | There is no listening socket, shell, terminal, subprocess, dev server, or HMR runtime.                                                                  |

## FAQ

### Can runesm execute CommonJS packages or `require()` calls?

No. CommonJS user code is explicitly out of scope. esm.sh can convert some package internals to browser ESM, but runesm never exposes `require`, `module.exports`, or a Node module loader. Use [almostnode](https://github.com/macaly/almostnode) when CommonJS and Node-style execution are requirements.

### Is the worker a security sandbox for hostile code?

No. The worker gives runesm a disposable realm and a hard termination path for infinite loops. Same-origin submitted code still has the browser capabilities granted to that worker, including network access. Use a separate origin and a stricter capability design when code is untrusted.

### Why can an API or package work in Chrome and fail in WebKit?

`runesm` uses the host JavaScript engine and browser APIs. Proposal-era built-ins, WebAssembly packaging, CDN output, CORS, and worker support can differ by browser. Pin package versions, test every target browser, and treat ⚠️ rows as conditional.
