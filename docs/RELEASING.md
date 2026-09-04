# Releasing

Only `packages/esmwell` may be published. The root workspace and demo applications are private, and Changesets is configured not to version or tag private packages.

## Every release

`pnpm release:verify` runs lint, typechecking, tests, a clean package build, export validation, the size budget, the packed-consumer build, and the Chrome browser suite. The release workflow runs it in a separate job that holds no publish credentials. The publish job then runs `pnpm release`, which rebuilds the package and calls `changeset publish` and nothing else. No long-lived npm token is required once trusted publishing is configured.

## First release

The GitHub release workflow is intentionally disabled before the first release. Before publishing, make the repository public, enable GitHub private vulnerability reporting, and confirm GitHub Actions can start jobs.

1. Run `pnpm version-packages`, review the generated version and changelog, and commit them as `chore: version packages`.
2. Verify and publish once without provenance in one command:

   ```bash
   pnpm release:verify && pnpm -C packages/esmwell publish --access public --no-git-checks --provenance=false
   ```

   This creates the npm package. Later releases use trusted publishing instead.

3. In the npm package settings, add a GitHub Actions trusted publisher for repository `jkomyno/esmwell` and workflow `release.yaml`.
4. Remove only the `if: false` guard from `.github/workflows/release.yaml`.
