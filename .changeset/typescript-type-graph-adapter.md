---
'esmwell': minor
---

Export `createTypeScriptTypeGraphAdapter` from `esmwell/typescript-editor` for shared declaration-graph replacement and package-aware TypeScript resolution. The compiler and language-service host remain supplied by the embedder. Use the adapter in the playground language worker and invalidate declaration snapshots when its graph changes.
