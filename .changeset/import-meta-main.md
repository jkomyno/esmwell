---
'esmwell': minor
---

Add `import.meta.main`, the entry signal Node.js, Deno, and Bun expose.

In a module project it is `true` in the module named by `entry` and `false` in every other module, including a `.js`/`.mjs` twin of a non-entry id; a twin of the entry registered with the same source reports `true` like the entry. Judge modules see `true`, each test file of a workspace sees `true`, and REPL inputs see `false`. `import.meta.url` and `import.meta.resolve` are unchanged. The property is added by rewriting each `import.meta` in place, so line numbers in stack traces and error reports stay where the author wrote them.
