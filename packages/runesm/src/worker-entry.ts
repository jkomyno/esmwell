import { runJudgeInRealm } from './bootstrap'
import { serializeValue } from './console'
import type { JudgeRunResult, WorkerRequest, WorkerResponse } from './types'

/** The minimal worker scope this entry needs. */
interface WorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as WorkerScope

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data
  if (request.kind !== 'judge') {
    return
  }
  void runJudgeInRealm(request.code, {
    cases: request.cases,
    deps: request.deps,
    autoInstall: request.autoInstall,
    onConsoleChunk: (chunk) => {
      postResponse({ kind: 'console', id: request.id, chunk })
    },
  }).then((result) => {
    postResponse({ kind: 'result', id: request.id, result })
  })
})

const postToMain = scope.postMessage.bind(scope)

const postResponse = (response: WorkerResponse): void => {
  try {
    postToMain(response)
  } catch {
    // The payload contained a value that cannot be structured-cloned (for
    // example a function returned by user code); retry with previews so the
    // main thread still learns how the run ended.
    if (response.kind === 'result') {
      postToMain({ ...response, result: withPreviews(response.result) })
    }
  }
}

const withPreviews = (result: JudgeRunResult): JudgeRunResult => ({
  ...result,
  cases: result.cases.map((caseResult) => ({
    ...caseResult,
    ...('actual' in caseResult ? { actual: serializeValue(caseResult.actual) } : {}),
    ...('expected' in caseResult ? { expected: serializeValue(caseResult.expected) } : {}),
  })),
})
