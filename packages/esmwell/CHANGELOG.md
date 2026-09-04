# esmwell

## 0.1.0

### Minor Changes

- b576199: Initial release: an ESM-only browser runner with judge, persistent REPL, and lazy Vitest/Jest workspace APIs. A coordinator delegates submitted judge and REPL modules to a disposable child worker, owns their deadline, and terminates a hung execution without losing trusted control state. Runtime-owned global bindings cannot be replaced or deleted. Bare imports resolve from esm.sh behind an `autoInstall` option and support versions pinned through `deps` or inline specifiers such as `effect@beta/Option`.
- c2fe225: Add a `esmwell/utils` subpath exporting `isBareSpecifier`, so a host can classify an import specifier without pulling in the resolver.

### Patch Changes

- 4b923b8: Make missing REPL identifiers report `ReferenceError` like a browser console while preserving `'undefined'` for direct `typeof` checks. Allow named ESM declarations to seed the persistent REPL scope.
