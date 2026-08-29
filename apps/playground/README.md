# playground

Judge and REPL demo for [`runesm`](../../packages/runesm): a TypeScript editor with its generated JavaScript counterpart, inspectable judge cases, an output panel streaming console output and per-case results, and a persistent REPL. The workers are bundled by vite from the runesm source entry, so the app works under its non-root base (`/playground/`) in dev and build.

## Design

The UI implements the root [`DESIGN.md`](../../DESIGN.md) against the audience and
principles in [`PRODUCT.md`](../../PRODUCT.md). `src/style.css` opens with the
token block those documents define; change the documents and the tokens together.

Archivo and Martian Mono are self-hosted through `@fontsource-variable`, imported
at the top of `src/style.css`, so no run depends on a third-party font request.
Martian Mono is set on its width axis (`font-stretch: 87.5%`, narrowing to `75%`
on small screens) rather than by shrinking the code type size.

The editor uses CodeMirror 6 for TypeScript and JavaScript syntax, keyboard
editing, diagnostics, and completion. A dedicated language-service worker keeps
that work off the page thread. In `.ts` mode it compiles the current source in
the browser before passing the emitted ESM to runesm; `.mjs` mode passes the
JavaScript source directly. The two views retain separate source: TypeScript
edits regenerate `.mjs` on navigation, syntax errors keep the editor in `.ts`,
and direct JavaScript edits disable `.ts` until Restore initial source resets
both views. The View tests disclosure exposes every fixed judge case before it
runs.

The first REPL command lazily evaluates the current editor module into the
persistent REPL scope, so declarations such as `export const solve` are directly
callable. Completion sees the editor module and successful prior commands, while
the right arrow accepts the faded inline suggestion from an empty input and the
up and down arrows traverse command history. Editing or restoring source, changing
language, or pressing Reset scope discards that scope; the next command reloads
the current module first.

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
