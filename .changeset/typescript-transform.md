---
'esmwell': minor
---

Add a `transform` option to every session and a `esmwell/typescript` entry.

`transform` rewrites submitted source on the main thread before it reaches the worker: the judge module, each REPL input, and each test-workspace module, with a context naming the entry point. Transforms run in submission order and a failure becomes an error result carrying the thrown name, message, and line/column.

`typescriptTransform` from `esmwell/typescript` compiles TypeScript with `ts.transpileModule` using a compiler the host supplies through `load: () => import('typescript')`, so the package never bundles or depends on the compiler.
