# playground

Judge-mode demo for [`runesm`](../../packages/runesm): an editor for user-authored ESM, an auto-detected deps list with optional version pins, and an output panel streaming console output and per-case results. The worker is bundled by vite from the runesm source entry, so the app works under its non-root base (`/playground/`) in dev and build.

```bash
pnpm --filter playground dev       # http://localhost:5173/playground/
pnpm --filter playground build     # builds dist/ and asserts the base prefix
pnpm --filter playground preview   # serves the built app
```
