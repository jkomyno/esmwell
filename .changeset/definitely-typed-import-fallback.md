---
'esmwell': patch
---

Fall back to the matching DefinitelyTyped package when an imported package ships no declarations, the way TypeScript's own resolver does, honouring the consumer's pinned `@types/*` range. Read tarball headers the way node-tar writes them, so DefinitelyTyped archives, which wrap files in the package name and carry timestamps in the prefix area, unpack correctly. `vitest` now brings in `@types/chai`, and `expect(...).not` type-checks in editors.
