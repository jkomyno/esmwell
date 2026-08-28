---
'runesm': minor
---

Initial release: an ESM-only in-browser code runner with judge and REPL modes over one web-worker foundation. Bare imports resolve from esm.sh behind an `autoInstall` option (default on) and support versions pinned through `deps` or inline specifiers such as `effect@beta/Option`; `process` and `node:process` provide one browser-identified process object; runs stream captured console output, and hung code terminates with a hard timeout. Test sessions use a 60-second default timeout, and their Jest version probe reads only response headers instead of downloading the engine bundle.
