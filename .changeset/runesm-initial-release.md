---
'runesm': minor
---

Initial release: an ESM-only in-browser code runner with judge and REPL modes over one web-worker foundation. Bare imports resolve from esm.sh behind an `autoInstall` option (default on, pin with `deps`), runs stream captured console output, and hung code terminates with a hard timeout.
