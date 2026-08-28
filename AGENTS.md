# Repository Guidance

`AGENTS.md` is the canonical repository-wide AI guidance file. `CLAUDE.md` is a symlink to this file so Claude Code and other agents read the same instructions without duplication.

## Guidance Hierarchy

Treat every `AGENTS.md` as a binding contract for its subtree. Before editing, read the guidance files from the repository root down to the target path. The closest file controls local details without weakening parent rules.

After meaningful changes, update the closest owning guidance when purpose, durable structure, contracts, workflows, verification, or generated artifacts change. Keep guidance concise and operational.

## Child Guidance Index

| Path                                                   | Scope                                                   |
| ------------------------------------------------------ | ------------------------------------------------------- |
| [`.agents/skills/AGENTS.md`](.agents/skills/AGENTS.md) | Repository-local skills, references, and agent metadata |

## Project Identity

This repository builds `runesm` — an ESM-only in-browser code runner with judge, REPL, and lazy Vitest/Jest workspace modes — as a pnpm/Turborepo monorepo maintained with Vitest, tsdown, oxfmt, oxlint, Changesets, and mise. The only publishable package lives in `packages/runesm`; the workspace root and every demo under `apps/` must stay private and excluded from Changesets publishing.

Preserve the runner's invariants: submitted judge and REPL modules run only inside a same-origin child execution worker, never inside their coordinator worker. Each judge run gets a fresh child. A REPL child persists only until reset, timeout, fatal failure, or session close. Test workspaces use one fresh directly owned worker per run because their service-worker-backed module graph must work in Chromium and WebKit. Runtime-owned global bindings cannot be overwritten, redefined, or deleted, while intended contents such as `process.env` remain mutable. Bare imports resolve via esm.sh (inline versions override `deps`, which override `autoInstall`), `process`, `node:process`, and `globalThis.process` expose the same browser-identified process object, test workspaces resolve exact canonical local ids before packages and load official engine components lazily, and error messages stay self-contained and actionable.

## Tooling Rules

- Treat `.mise.toml` as the source of truth for Node.js and pnpm versions. Keep the root `packageManager` version aligned with it.
- Use pnpm for dependency and workspace commands. Reuse existing root and package scripts before inventing ad hoc commands.
- Keep shared configuration at the repository root and package-specific configuration beside the owning package.
- Keep the pre-commit hook in `lefthook.yml` and its staged-file checks in the root `lint-staged` configuration.
- Let oxfmt and oxlint enforce formatting and lint style.
- Do not edit generated output, dependency directories, or lockfile sections by hand.

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
pnpm -C packages/runesm run check:size    # 50 KB gzip budget over the built ESM output; run after pnpm build
```

For documentation-only changes, `pnpm lint:ci` is sufficient unless the documentation describes executable commands or configuration that also needs validation.
