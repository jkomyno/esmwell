# Repository Guidance

`AGENTS.md` is the canonical repository-wide AI guidance file. `CLAUDE.md` is a symlink to this file so Claude Code and other agents read the same instructions without duplication.

## Guidance Hierarchy

Treat every `AGENTS.md` as a binding contract for its subtree. Before editing, read the guidance files from the repository root down to the target path. The closest file controls local details without weakening parent rules.

After meaningful changes, update the closest owning guidance when purpose, durable structure, contracts, workflows, verification, or generated artifacts change. Keep guidance concise and operational.

## Child Guidance Index

| Path                                                   | Scope                                                   |
| ------------------------------------------------------ | ------------------------------------------------------- |
| [`.agents/skills/AGENTS.md`](.agents/skills/AGENTS.md) | Repository-local skills, references, and agent metadata |

## Design Context

Before changing anything the user sees in [`apps/playground`](apps/playground), read both root design files:

- [`PRODUCT.md`](PRODUCT.md): register (brand), users, purpose, brand personality, anti-references, design principles, accessibility bar.
- [`DESIGN.md`](DESIGN.md): the visual system. OKLCH palette with verified contrast ratios, Archivo + Martian Mono type scale, elevation, components, and the do's and don'ts. `.impeccable/design.json` carries the tonal ramps, motion tokens, and renderable component snippets that the DESIGN.md frontmatter schema cannot hold.

`apps/playground` implements `DESIGN.md`. Treat the stylesheet's token block as the rendered form of that system: change the document and the stylesheet together, and do not reintroduce a value the do's and don'ts rule out.

## Project Identity

This repository builds `runesm` — an ESM-only in-browser code runner with judge, REPL, and lazy Vitest/Jest workspace modes — as a pnpm/Turborepo monorepo maintained with Vitest, tsdown, oxfmt, oxlint, Changesets, and mise. The only publishable package lives in `packages/runesm`; the workspace root and every demo under `apps/` must stay private and excluded from Changesets publishing.

Preserve the runner's invariants: submitted judge and REPL modules run only inside a same-origin child execution worker, never inside their coordinator worker. Each judge run gets a fresh child. A REPL child persists only until reset, timeout, fatal failure, or session close. Named ESM declarations can seed its persistent scope; local export lists add no bindings, while re-exports remain unsupported. Missing REPL identifiers report `ReferenceError`, while a direct `typeof` check returns `'undefined'`. Test workspaces use one fresh directly owned worker per run because their service-worker-backed module graph must work in Chromium and WebKit. Runtime-owned global bindings cannot be overwritten, redefined, or deleted, while intended contents such as `process.env` remain mutable. Bare imports resolve via esm.sh (inline versions override `deps`, which override `autoInstall`), `process`, `node:process`, and `globalThis.process` expose the same browser-identified process object, test workspaces resolve exact canonical local ids before packages and load official engine components lazily, and error messages stay self-contained and actionable.

The private playground uses CodeMirror 6 for both source and REPL input. Its `.ts` mode compiles in a dedicated browser worker before passing emitted ESM to runesm; `.mjs` shows that generated JavaScript and passes it directly. TypeScript edits invalidate the generated view, invalid TypeScript cannot open `.mjs`, and direct JavaScript edits lock `.ts` until the source restore control resets both views. This is a playground authoring feature, not a runesm package capability.

## Tooling Rules

- Treat `.mise.toml` as the source of truth for Node.js and pnpm versions. Keep the root `packageManager` version aligned with it.
- Use pnpm for dependency and workspace commands. Reuse existing root and package scripts before inventing ad hoc commands.
- Keep shared configuration at the repository root and package-specific configuration beside the owning package.
- Keep the pre-commit hook in `lefthook.yml` and its staged-file checks in the root `lint-staged` configuration.
- Let oxfmt and oxlint enforce formatting and lint style.
- Do not edit generated output, dependency directories, or lockfile sections by hand.
- `docs/media/playground.gif` is generated, not hand-edited. Re-record it with `pnpm --filter playground demo` (tcut, defined by `apps/playground/demo.video.ts`) whenever the playground UI or its default example changes.

## TypeScript Rules

- Follow the strict compiler options and project-reference structure already defined by the root `tsconfig*.json` files.
- Preserve package boundaries. Import through public workspace entrypoints instead of reaching into another package's internals.
- Design exported APIs deliberately and keep declaration emit valid under `isolatedDeclarations`, `isolatedModules`, and `verbatimModuleSyntax`.
- Use the repository-local [`typescript` skill](.agents/skills/typescript/SKILL.md) for typecheck failures, exported API design, unsafe boundaries, or non-trivial TypeScript changes.

## Testing Rules

- Put unit tests in `__tests__/unit` and integration tests in `__tests__/integration`.
- Keep unit tests deterministic and free of live network, real-time waits, and leaked process-wide state.
- Test behavior through public APIs when the contract crosses a package boundary.
- Use the repository-local [`testing` skill](.agents/skills/testing/SKILL.md) when adding, changing, debugging, or reviewing tests.

## Verification

Run the narrowest relevant check while iterating. Before handing off code or configuration changes, run:

```bash
pnpm lint:ci
pnpm typecheck
pnpm test
pnpm build
```

CI additionally gates two checks that are not part of the four above. Run them
when touching the runner, its build output, or the browser path:

```bash
pnpm -C packages/runesm run test:browser  # real-browser suite; needs bun (pinned in .mise.toml) and a Chrome/WebKit backend, and reaches esm.sh
pnpm -C packages/runesm run check:size    # 30 KB gzip budget over the built ESM output; run after pnpm build
```

For documentation-only changes, `pnpm lint:ci` is sufficient unless the documentation describes executable commands or configuration that also needs validation.
