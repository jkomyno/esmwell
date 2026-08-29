---
'runesm': patch
---

Make missing REPL identifiers report `ReferenceError` like a browser console while preserving `'undefined'` for direct `typeof` checks. Allow named ESM declarations to seed the persistent REPL scope.
