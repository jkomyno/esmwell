import { createReplSessionInRealm, runJudgeInRealm, serializeError } from './bootstrap'
import type { ReplRealmSession } from './bootstrap'
import { installBrowserProcess } from './browser-process'
import { serializeValue } from './console'
import type { JudgeRunResult, ReplResult, WorkerRequest, WorkerResponse } from './types'

/** The minimal worker scope this entry needs. */
interface WorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as WorkerScope

installBrowserProcess()

const postToMain = scope.postMessage.bind(scope)

/** The worker's REPL session, created lazily with the first input's options. */
let replSession: ReplRealmSession | null = null

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data

  if (request.kind === 'judge') {
    void runJudgeInRealm(request.code, {
      cases: request.cases,
      deps: request.deps,
      autoInstall: request.autoInstall,
      onConsoleChunk: (chunk) => {
        postResponse({ kind: 'console', id: request.id, chunk })
      },
    })
      .then((result) => {
        postResponse({ kind: 'result', id: request.id, result })
      })
      .catch((error: unknown) => {
        // runJudgeInRealm documents that it never throws, but console-capture
        // setup happens before its try block and restoreConsole() in its
        // finally can itself throw — either would otherwise leave this
        // request's id unanswered until the caller's timeout fires.
        postResponse({ kind: 'result', id: request.id, result: judgeErrorResult(error) })
      })
    return
  }

  if (request.kind === 'repl-input') {
    if (replSession === null) {
      replSession = createReplSessionInRealm({ deps: request.deps, autoInstall: request.autoInstall })
    }
    void replSession
      .evaluate(request.input, {
        onConsoleChunk: (chunk) => {
          postResponse({ kind: 'console', id: request.id, chunk })
        },
      })
      .then((result) => {
        postResponse({ kind: 'repl-result', id: request.id, result })
      })
      .catch((error: unknown) => {
        postResponse({ kind: 'repl-result', id: request.id, result: replErrorResult(error) })
      })
    return
  }

  if (request.kind === 'repl-reset') {
    replSession?.reset()
    postResponse({ kind: 'repl-ack', id: request.id })
    return
  }

  // Reachable only under request/response version skew: `index.mjs` and
  // this worker bundle are cached and served independently, so a host can
  // serve a main-thread bundle that sends a request kind this worker build
  // predates. Without this, the request's id is never answered and the
  // caller silently times out. The three branches above are exhaustive for
  // this build's `WorkerRequest`, so TypeScript narrows `request` to
  // `never` here; the cast below only widens it back to read the two
  // fields every request shape carries at runtime regardless.
  const unrecognized = request as unknown as { readonly id: number; readonly kind: unknown }
  postResponse({
    kind: 'result',
    id: unrecognized.id,
    result: judgeErrorResult(new Error(`worker received an unrecognized request kind '${String(unrecognized.kind)}'`)),
  })
})

const postResponse = (response: WorkerResponse): void => {
  if (tryPost(response)) {
    return
  }

  // The payload contained a value that cannot be structured-cloned (for
  // example a function returned by user code); retry with previews so the
  // main thread still learns how the run ended.
  const preview = withPreviews(response)
  if (preview !== null && tryPost(preview)) {
    return
  }

  // The retry itself failed (or there was nothing to preview). Fall back to
  // a minimal, always-cloneable response so the caller's request still
  // settles instead of being lost and timing out.
  tryPost(fallbackResponse(response))
}

/** Attempts one postMessage; reports success instead of letting a clone failure escape. */
const tryPost = (response: WorkerResponse): boolean => {
  try {
    postToMain(response)
    return true
  } catch {
    return false
  }
}

const withPreviews = (response: WorkerResponse): WorkerResponse | null => {
  if (response.kind === 'result') {
    return { ...response, result: judgeResultWithPreviews(response.result) }
  }
  if (response.kind === 'repl-result') {
    return { ...response, result: replResultWithPreviews(response.result) }
  }
  return null
}

const fallbackResponse = (response: WorkerResponse): WorkerResponse => ({
  kind: 'result',
  id: response.id,
  result: judgeErrorResult(new Error('worker response could not be sent to the main thread')),
})

const judgeErrorResult = (error: unknown): JudgeRunResult => ({
  status: 'error',
  ok: false,
  cases: [],
  console: [],
  error: serializeError(error),
  dependencies: [],
  durationMs: 0,
})

const replErrorResult = (error: unknown): ReplResult => ({
  ok: false,
  error: serializeError(error),
  console: [],
  dependencies: [],
  durationMs: 0,
})

const judgeResultWithPreviews = (result: JudgeRunResult): JudgeRunResult => ({
  ...result,
  cases: result.cases.map((caseResult) => ({
    ...caseResult,
    ...('actual' in caseResult ? { actual: serializeValue(caseResult.actual) } : {}),
    ...('expected' in caseResult ? { expected: serializeValue(caseResult.expected) } : {}),
  })),
})

const replResultWithPreviews = (result: ReplResult): ReplResult => ({
  ...result,
  ...('value' in result ? { value: serializeValue(result.value) } : {}),
})
