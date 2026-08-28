# Contributing

## Setup

[mise](https://mise.jdx.dev/getting-started.html) owns the Node.js, pnpm, and Bun versions used by this repository.

```bash
mise trust
mise install
pnpm install
```

When changing a tool version, update `.mise.toml`, run `mise lock`, and keep the root `packageManager` pin aligned.

## Development

Use the existing workspace scripts:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint:ci
```

Changes to the runner, its built assets, or browser behavior also require:

```bash
pnpm -C packages/runesm run test:browser
pnpm -C packages/runesm run check:size
```

The browser suite reaches esm.sh. Bun and a Chromium or WebKit backend must be available.

Tests live under each package's `__tests__` directory. Keep unit tests deterministic and offline. Use integration or browser tests for package boundaries and browser-only behavior.

## Changesets and publishing

User-visible library changes need a changeset:

```bash
pnpm changeset
```

Only `packages/runesm` may be published. The root workspace and demo applications are private, and Changesets is configured not to version or tag private packages.

The GitHub release workflow is intentionally disabled before the first release. To enable npm trusted publishing:

1. Publish `runesm` manually once so the package exists on npm.
2. In the npm package settings, add a GitHub Actions trusted publisher for `jkomyno/runesm` and `release.yaml`.
3. Remove the disabled guard in `.github/workflows/release.yaml` and enable the Changesets action step.

No long-lived npm token is required after trusted publishing is configured.
