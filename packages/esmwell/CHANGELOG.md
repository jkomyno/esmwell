# esmwell

## 0.3.0

### Minor Changes

- 1710854: Export `canonicalModuleId` and `createProjectModules` from `esmwell/utils` so project and test embedders share editor-path conversion, script extension aliases, and collision errors. Sources remain unchanged.

  Generated `.cjs` entry aliases also share the canonical entry’s `import.meta.main` flag. Their sources still execute as ESM.

- ec31a99: Add `import.meta.main`, the entry signal Node.js, Deno, and Bun expose.

  In a module project it is `true` in the module named by `entry` and `false` in every other module, including a `.js`/`.mjs` twin of a non-entry id; a twin of the entry registered with the same source reports `true` like the entry. Judge modules see `true`, each test file of a workspace sees `true`, and REPL inputs see `false`. `import.meta.url` and `import.meta.resolve` are unchanged. The property is added by rewriting each `import.meta` in place, so line numbers in stack traces and error reports stay where the author wrote them.

  `esmwell/typescript-editor` also exports `ESMWELL_RUNTIME_TYPES`, the ambient declaration of the flag, so an editor host seeds it beside an acquired declaration graph instead of writing its own.

- bba859b: Export `createTypeScriptTypeGraphAdapter` from `esmwell/typescript-editor` for shared declaration-graph replacement and package-aware TypeScript resolution. The compiler and language-service host remain supplied by the embedder. Use the adapter in the playground language worker and invalidate declaration snapshots when its graph changes.

### Patch Changes

- ee9af88: Make project and test session `close()` terminate active workers and settle pending runs as errors. Closure also cancels waiting for source transforms and service-worker setup, prevents late worker creation, and cleans up each run's graph cache.

## 0.2.0

### Minor Changes

- c7ba31f: Add one-shot virtual ESM module-project execution with relative imports, native cycles and live bindings, runtime bare-package resolution, and hard worker timeouts.
- e3de2c8: Add the opt-in `esmwell/typescript-editor` declaration-acquisition kit for browser editors.

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
