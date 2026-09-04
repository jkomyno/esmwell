# esmwell

## 0.1.0

### Minor Changes

- d15f725: Add a `transform` option to every session and a `esmwell/typescript` entry.

  `transform` rewrites submitted source on the main thread before it reaches the worker: the judge module, each REPL input, and each test-workspace module, with a context naming the entry point. Transforms run in submission order and a failure becomes an error result carrying the thrown name, message, and line/column.

  `typescriptTransform` from `esmwell/typescript` compiles TypeScript with `ts.transpileModule` using a compiler the host supplies through `load: () => import('typescript')`, so the package never bundles or depends on the compiler.

- 6356836: Export the worker RPC pair and the console formatter from `esmwell/utils`.

  `createWorkerRpc` and `serveWorkerRpc` give a host the request/response plumbing for a worker it owns (correlation ids, pending map, failure rejection, lazy start, restart, destroy, per-request `AbortSignal`). `formatConsoleArguments` and `serializeValue` expose the rendering the runner applies to captured console output. `adaptWorker` and `WorkerLike` are available from `esmwell/utils` as well as the main entry.

- b576199: Initial release: an ESM-only browser runner with judge, persistent REPL, and lazy Vitest/Jest workspace APIs. A coordinator delegates submitted judge and REPL modules to a disposable child worker, owns their deadline, and terminates a hung execution without losing trusted control state. Runtime-owned global bindings cannot be replaced or deleted. Bare imports resolve from esm.sh behind an `autoInstall` option and support versions pinned through `deps` or inline specifiers such as `effect@beta/Option`.
- c2fe225: Add a `esmwell/utils` subpath exporting `isBareSpecifier`, so a host can classify an import specifier without pulling in the resolver.

### Patch Changes

- 4b923b8: Make missing REPL identifiers report `ReferenceError` like a browser console while preserving `'undefined'` for direct `typeof` checks. Allow named ESM declarations to seed the persistent REPL scope.
