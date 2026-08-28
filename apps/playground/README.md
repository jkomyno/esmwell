# playground

Judge and REPL demo for [`runesm`](../../packages/runesm): an editor for user-authored ESM, an auto-detected deps list with optional version pins, an output panel streaming console output and per-case results, and a persistent REPL. The workers are bundled by vite from the runesm source entry, so the app works under its non-root base (`/playground/`) in dev and build.

```bash
pnpm --filter playground dev       # http://localhost:5173/playground/
pnpm --filter playground build     # builds dist/ and asserts the base prefix
pnpm --filter playground preview   # serves the built app
```

## Demo recording

`docs/media/playground.gif` in the repository root is recorded from this app by
[tcut](https://github.com/AmanVarshney01/tcut):

```bash
pnpm --filter playground demo      # re-records and re-renders the GIF
```

[`demo.video.ts`](./demo.video.ts) is the source of that recording. It builds
and previews the app rather than using `vite dev`, because the dev client is
bundled into the execution worker too and its `[vite] connected.` log would
show up as real console output in the output panel. The script asserts on the
screen as it goes, so a broken playground fails the recording instead of
producing a misleading GIF.
