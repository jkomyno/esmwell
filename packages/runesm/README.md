# runesm

An ESM-only in-browser code runner with judge and REPL modes, over one web-worker foundation.

User code runs as ES2023 modules inside a dedicated worker: bare imports (`import isEven from 'is-even'`) resolve at runtime from [esm.sh](https://esm.sh), console output streams back while code executes, and runs that exceed their timeout are terminated — infinite loops become a timeout result, not a frozen page.

## Install

```bash
pnpm add runesm
```

The package ships ESM only (`.mjs`), with a single runtime dependency on [acorn](https://github.com/acornjs/acorn).

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

Results compare structurally (`NaN` equals `NaN`, `+0` ≠ `-0`, `Map`/`Set` ignore insertion order, TypedArrays compare byte-wise, prototypes must match).

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
- `deps` pins exact versions; `autoInstall: true` (the default) resolves everything else to the CDN's latest.
- `autoInstall: false` makes an unpinned bare import an error: `could not resolve 'x' — check the package name or add it to deps`.
- Absolute URLs pass through untouched; relative specifiers error (user code runs from an in-memory URL); `node:*` imports fail fast with module-specific pointers to browser alternatives (`node:crypto` → `globalThis.crypto`, `node:http` → `fetch()`, …).
- Both modes surface the resolved dependency list (`name`, `version`, `url`) in their results so hosts can display what a run actually used.

## Policy

Submitted code is rejected (with line numbers) for `var` declarations, `eval` references, and `Function`-constructor calls — before anything executes.

## Workers and bundlers

`createRunesm` loads `worker-entry.mjs` next to the main-thread module by default. Bundlers that relocate assets should build the worker themselves:

```ts
import { adaptWorker, createRunesm } from 'runesm'
import RunesmWorker from './runesm-worker?worker' // vite; the file does `import 'runesm/worker-entry'`

const session = createRunesm({ workerFactory: () => adaptWorker(new RunesmWorker()) })
```

`workerUrl` is the lighter escape hatch when a URL to the shipped entry is available.

## Testing your integration

The package's own suite includes a real-browser harness ([`scripts/browser-test.ts`](./scripts/browser-test.ts), run with `bun`): it serves the built package, drives it in a headless WebView, and exercises the real worker against esm.sh. `pnpm test` stays offline and deterministic (data-URL imports only).

## License

MIT
