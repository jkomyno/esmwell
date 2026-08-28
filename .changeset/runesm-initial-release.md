---
'runesm': minor
---

Initial release: an ESM-only browser runner with judge, persistent REPL, and lazy Vitest/Jest workspace APIs. A coordinator delegates submitted judge and REPL modules to a disposable child worker, owns their deadline, and terminates a hung execution without losing trusted control state. Runtime-owned global bindings cannot be replaced or deleted. Bare imports resolve from esm.sh behind an `autoInstall` option and support versions pinned through `deps` or inline specifiers such as `effect@beta/Option`.
