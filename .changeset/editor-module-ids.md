---
'esmwell': minor
---

Export `canonicalModuleId` and `createProjectModules` from `esmwell/utils` so project and test embedders share editor-path conversion, script extension aliases, and collision errors. Sources remain unchanged.

Generated `.cjs` entry aliases also share the canonical entry’s `import.meta.main` flag. Their sources still execute as ESM.
