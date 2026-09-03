---
'runesm': minor
---

Export the worker RPC pair and the console formatter from `runesm/utils`.

`createWorkerRpc` and `serveWorkerRpc` give a host the request/response plumbing for a worker it owns (correlation ids, pending map, failure rejection, lazy start, restart, destroy, per-request `AbortSignal`). `formatConsoleArguments` and `serializeValue` expose the rendering the runner applies to captured console output. `adaptWorker` and `WorkerLike` are available from `runesm/utils` as well as the main entry.
