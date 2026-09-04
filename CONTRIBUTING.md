# Contributing

## Setup

[mise](https://mise.jdx.dev/getting-started.html) owns the Node.js, pnpm, and Bun versions used by this repository.

```bash
mise trust
mise install
pnpm install
```

When changing a tool version, update `.mise.toml`, run `mise lock`, and keep the root `packageManager` pin aligned.

## Checks

Run the narrowest relevant check while iterating. Before opening a pull request, run all four:

```bash
pnpm lint:ci
pnpm typecheck
pnpm test
pnpm build
```

Changes to the runner, its built assets, or browser behavior also require:

```bash
pnpm -C packages/esmwell run test:browser  # needs Bun and Chrome, reaches esm.sh
pnpm -C packages/esmwell run check:size    # 30 KB gzip budget over runner-core output; run after pnpm build
pnpm -C packages/esmwell run test:pack     # installs the tarball in a temporary Vite consumer
```

WebKit is optional and is not a release gate.

## Tests

Tests live under each package's `__tests__` directory: `unit` for deterministic, offline tests, `integration` for package boundaries, and `browser` for behavior that needs real workers and esm.sh.

## Playground

```bash
pnpm --filter playground dev   # http://localhost:5173/playground/
```

The demo recording in `docs/media` is generated. See the [playground README](./apps/playground/README.md) to re-record it after a UI change.

## Changesets

User-visible library changes need a changeset:

```bash
pnpm changeset
```

Maintainers publish from `main` through the release workflow. See [docs/RELEASING.md](./docs/RELEASING.md).
