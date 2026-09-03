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
pnpm -C packages/esmwell run test:browser
pnpm -C packages/esmwell run check:size
```

The browser suite reaches esm.sh. Bun and Chrome must be available. WebKit is optional and is not a release gate.

Tests live under each package's `__tests__` directory. Keep unit tests deterministic and offline. Use integration or browser tests for package boundaries and browser-only behavior.

## Changesets and publishing

User-visible library changes need a changeset:

```bash
pnpm changeset
```

Only `packages/esmwell` may be published. The root workspace and demo applications are private, and Changesets is configured not to version or tag private packages.

The GitHub release workflow is intentionally disabled before the first release. Before publishing, make the repository public, enable GitHub private vulnerability reporting, and confirm GitHub Actions can start jobs.

For the first release:

1. Run `pnpm version-packages`, review the generated `0.1.0` version and changelog, and commit them as `chore: version packages`.
2. Verify and publish once without provenance in one command: `pnpm release:verify && pnpm -C packages/esmwell publish --access public --no-git-checks --provenance=false`. This creates the npm package; later releases use trusted publishing instead.
3. In the npm package settings, add a GitHub Actions trusted publisher for repository `jkomyno/esmwell` and workflow `release.yaml`.
4. Remove only the `if: false` guard from `.github/workflows/release.yaml`.

`pnpm release:verify` runs lint, typechecking, tests, a clean package build, export validation, the size budget, the packed-consumer build, and the Chrome browser suite. The release workflow runs it in a separate job that holds no publish credentials; the publish job then runs `pnpm release`, which rebuilds the package and calls `changeset publish` and nothing else. No long-lived npm token is required after trusted publishing is configured.
