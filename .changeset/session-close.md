---
'esmwell': patch
---

Make project and test session `close()` terminate active workers and settle pending runs as errors. Closure also cancels waiting for source transforms and service-worker setup, prevents late worker creation, and cleans up each run's graph cache.
