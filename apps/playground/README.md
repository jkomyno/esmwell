# playground

Demo for [`esmwell`](../../packages/esmwell): a TypeScript editor with its generated JavaScript counterpart, an output panel streaming console output, a persistent REPL, and a small set of inspectable cases the module can be checked against. The workers are bundled by Vite from the esmwell source entry, so the app works under its non-root base (`/playground/`) in dev and build.

```bash
pnpm --filter playground dev       # http://localhost:5173/playground/
pnpm --filter playground build     # builds dist/ and asserts the base prefix
pnpm --filter playground preview   # serves the built app
```

## Editor

CodeMirror 6 provides TypeScript and JavaScript syntax, keyboard editing, diagnostics, completion, and inferred-type hover help. A dedicated language-service worker keeps that work off the page thread and acquires cached npm declaration graphs on demand for bare imports, including inline versions such as `effect@beta` and `zod@4`. On load it warms that worker with the default module's declarations and one full type-check, so the first hover does not wait for the download.

In `.ts` mode the app compiles the current source in the browser before passing the emitted ESM to esmwell. `.mjs` mode passes the JavaScript source directly. The two views keep separate source: TypeScript edits regenerate `.mjs` on navigation, syntax errors keep the editor in `.ts`, and direct JavaScript edits disable `.ts` until Restore initial source resets both views.

The Test cases drawer, open by default, sits inside the editor well and takes height from the source view rather than covering it. It lists every fixed judge case with its exact invocation before it runs.

The default module decodes a typed user with Effect Schema and generates its time-ordered UUID v7 through the exact `uniku@0.6.0/uuid/v7` entrypoint.

## REPL

The first REPL command lazily evaluates the current editor module into the persistent REPL scope, so declarations such as `export const solve` are directly callable. Completion sees the editor module and successful prior commands. The right arrow accepts the faded inline suggestion from an empty input, and the up and down arrows traverse command history. Editing or restoring source, changing language, or pressing Reset scope discards that scope. The next command reloads the current module first.

## Layout and design

The UI implements the root [`DESIGN.md`](../../DESIGN.md) against the audience and principles in [`PRODUCT.md`](../../PRODUCT.md). `src/style.css` opens with the token block those documents define. Change the documents and the tokens together.

Archivo and Martian Mono are self-hosted through `@fontsource-variable`, imported at the top of `src/style.css`, so no run depends on a third-party font request. Martian Mono is set on its width axis (`font-stretch: 87.5%`, narrowing to `75%` on small screens) rather than by shrinking the code type size.

Above `68rem`, the editor and response surfaces share the available viewport. Below it, the panes stack and the editor uses a bounded, viewport-aware height so Output and REPL remain nearby. The console well has a fixed height and the results region reserves its height from the case count, so a run never moves the REPL beneath it. The REPL entry is a single line, and the history well grows to anchor it to the bottom edge of the editor well. Interactive controls retain a 44px minimum target at every width.

## Demo recording

`docs/media/playground.gif` in the repository root is recorded from this app by [tcut](https://github.com/AmanVarshney01/tcut):

```bash
pnpm --filter playground demo         # re-records the 2x master (ignored by git)
pnpm --filter playground demo:social  # derives playground.gif and playground.mp4 from it (needs ffmpeg)
```

tcut renders the master at 2x (2560×1600, 50 fps) to `docs/media/playground-2x.gif`, which is too large to commit and sharper than X accepts for a GIF. `demo:social` writes the two files that ship: `docs/media/playground.gif` (1280×800, 15 fps, under X's 350-frame limit; the README embeds it) and `docs/media/playground.mp4` (1280×800, 30 fps). Run it after every `demo`.

[`demo.video.ts`](./demo.video.ts) is the source of that recording. It builds and previews the app rather than using `vite dev`, because the dev client is bundled into the execution worker too and its `[vite] connected.` log would show up as real console output in the output panel. The script asserts on the screen as it goes, so a broken playground fails the recording instead of producing a misleading GIF.
