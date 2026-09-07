---
'esmwell': minor
---

Add an optional `engineVersion` field to `TestRun` so a host can pin the upstream Vitest or Jest engine to a specific npm version, range, or dist-tag (for example `'5'` to stay on Vitest 5.x) instead of always resolving `latest` from esm.sh. Omitting it keeps the existing `latest` behavior.
