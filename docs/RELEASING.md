# Releasing

Only `packages/esmwell` may be published. The root workspace and demo applications are private, and Changesets is configured not to version or tag private packages.

## Every release

`pnpm release:verify` runs lint, typechecking, tests, a clean package build, export validation, the size budget, the packed-consumer build, and the Chrome browser suite. The release workflow runs it in a separate job that holds no publish credentials. The publish job then runs `pnpm release`, which rebuilds the package and calls `changeset publish` and nothing else. No long-lived npm token is required once trusted publishing is configured.

## Trusted publishing

npm trusts the GitHub Actions workflow `jkomyno/esmwell/.github/workflows/release.yaml` to publish `esmwell`. The publish job runs on a GitHub-hosted runner with `id-token: write`, so npm exchanges GitHub's short-lived OIDC identity for publish access and records provenance. Do not add an `NPM_TOKEN` secret.

GitHub Actions must retain permission to create pull requests in the repository settings because the Changesets action maintains the version PR.

1. Add a Changeset with the implementation and merge it to `main`.
2. Review and merge the `chore: version packages` pull request created or updated by the release workflow.
3. Confirm the next release run published the expected version, npm dist-tag, provenance, Git tag, and GitHub release.
