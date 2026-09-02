# runesm

[![npm version](https://img.shields.io/npm/v/runesm?color=blue)](https://npmjs.com/package/runesm)
[![npm downloads](https://img.shields.io/npm/dm/runesm?color=blue)](https://npm.chart.dev/runesm)
[![install size](https://badgen.net/packagephobia/install/runesm?color=blue)](https://packagephobia.com/result?p=runesm)
[![license](https://img.shields.io/npm/l/runesm?color=blue)](./LICENSE)

Run unbundled ESM in the browser with hard timeouts, dependency resolution, and normalized results.

![runesm playground running an Effect v4 program](./docs/media/playground.gif)

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

## Choosing the right tool

These projects all accept JavaScript-shaped input, but they solve different problems:

| Tool                                                        | Best for                                                                   | Execution model                                                                                             | Packages and environment                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **runesm**                                                  | Embedded browser judges, persistent REPLs, and Vitest/Jest workspaces      | Executes real ESM in browser workers with hard timeout recovery; worker isolation is not a security sandbox | Resolves bare imports through esm.sh; browser APIs, no virtual filesystem or general Node.js runtime              |
| [**callscript**](https://github.com/vercel-labs/callscript) | AI-authored tool workflows that need bounded, inspectable, resumable plans | Parses a constrained JavaScript surface into inert JSON; only host-provided tools execute                   | Mounts tools through plain adapters, the AI SDK, or MCP; it does not execute arbitrary JavaScript or npm packages |
| [**almostnode**](https://github.com/macaly/almostnode)      | Node-style browser development environments and playgrounds                | Executes code on the main thread, in a worker, or through its separately deployed cross-origin sandbox      | Provides a virtual filesystem, Node.js API shims, npm installation, CLIs, and Vite/Next.js dev servers            |

`callscript` and runesm both parse JavaScript with Acorn and validate it before work begins, but only runesm continues on to execute the submitted module. `almostnode` is the closer runtime alternative: choose it when Node.js compatibility is the requirement, and runesm when ESM-native execution, structured judge results, or a focused test-workspace API is the requirement.

## Repository

- [`packages/runesm`](./packages/runesm): publishable library and complete API guide
- [`COMPATIBILITY.md`](./COMPATIBILITY.md): verified ECMAScript, package, and runtime compatibility matrix
- [`apps/playground`](./apps/playground): private demo application
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): local setup, checks, and release procedure

Only `packages/runesm` is publishable. The workspace root and every package under `apps/` stay private and are excluded from Changesets publishing.

## License

[MIT](./LICENSE) © [Alberto Schiabel](https://github.com/jkomyno)
