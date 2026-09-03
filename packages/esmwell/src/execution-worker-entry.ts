import { createReplSessionInRealm, runJudgeInRealm, serializeError } from './bootstrap'
import type { ReplRealmSession } from './bootstrap'
import { installBrowserProcess } from './browser-process'
import { protectConsole, serializeValue } from './console'
import type { JudgeRunResult, ReplResult, WorkerRequest, WorkerResponse } from './types'

/** The minimal execution-worker scope this entry needs. */
interface ExecutionWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as ExecutionWorkerScope

installBrowserProcess()
protectConsole()

const postToSupervisor = scope.postMessage.bind(scope)

/** The REPL state owned by this disposable execution realm. */
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

  const unrecognized = request as unknown as { readonly id: number; readonly kind: unknown }
  postResponse({
    kind: 'result',
    id: unrecognized.id,
    result: judgeErrorResult(
      new Error(`execution worker received an unrecognized request kind '${String(unrecognized.kind)}'`),
    ),
  })
})

const postResponse = (response: WorkerResponse): void => {
  if (tryPost(response)) {
    return
  }

  const preview = withPreviews(response)
  if (preview !== null && tryPost(preview)) {
    return
  }

  tryPost(fallbackResponse(response))
}

const tryPost = (response: WorkerResponse): boolean => {
  try {
    postToSupervisor(response)
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
  result: judgeErrorResult(new Error('execution worker response could not be sent to the supervisor')),
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
