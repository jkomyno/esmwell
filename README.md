# runesm

Run unbundled ESM in the browser with hard timeouts, dependency resolution, and normalized results.

`runesm` is an ESM-only browser library for three interactive-code workloads:

- **Judge:** execute named exports against structured test cases in a fresh realm.
- **REPL:** keep declarations and imports alive until reset or timeout.
- **Test workspace:** run virtual ESM projects with lazy-loaded Vitest or Jest engines.

Bare imports resolve through [esm.sh](https://esm.sh). Inline versions take priority over `deps`, and `deps` take priority over `autoInstall`.

```ts
import { createRunesm } from 'runesm'

const session = createRunesm({
  deps: { 'is-even': '1.0.0' },
  timeoutMs: 5_000,
})

const result = await session.runJudge(
  `import isEven from 'is-even'
   export const solve = (value) => isEven(value)`,
  [{ name: 'two is even', exportName: 'solve', args: [2], expected: true }],
)

session.close()
```

## Execution model

Judge and REPL requests pass through a trusted coordinator worker. Submitted modules execute only in a same-origin child worker that the coordinator can terminate. Judge runs always get a fresh child. A REPL keeps one child while its state is live, then replaces it after reset, timeout, or fatal failure.

Test workspaces use a fresh directly owned worker per run so their service-worker-backed module graph works consistently in Chromium and WebKit.

Runtime-owned global bindings such as `process`, `console`, and the test-engine bridges cannot be replaced or deleted by submitted code. Intended mutable state such as `process.env` remains mutable.

This provides disposable browser realms and reliable timeout recovery. It is not a security boundary equivalent to a process, VM, V8 isolate, or Cloudflare Workers runtime. Submitted code retains the browser worker capabilities allowed by the host, including network access unless the host restricts it.

## Repository

- [`packages/runesm`](./packages/runesm): publishable library and complete API guide
- [`apps/playground`](./apps/playground): private demo application
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): local setup, checks, and release procedure

Only `packages/runesm` is publishable. The workspace root and every package under `apps/` stay private and are excluded from Changesets publishing.

## Status

The package is preparing for its first npm release. The release workflow remains disabled until the initial package and npm trusted publisher are configured.

## License

[MIT](./LICENSE) © [Alberto Schiabel](https://github.com/jkomyno)
