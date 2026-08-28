import { createReplSessionInRealm, runJudgeInRealm } from './bootstrap'
import type { ReplRealmSession } from './bootstrap'
import { serializeValue } from './console'
import type { JudgeRunResult, ReplResult, WorkerRequest, WorkerResponse } from './types'

/** The minimal worker scope this entry needs. */
interface WorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as WorkerScope

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
    }).then((result) => {
      postResponse({ kind: 'result', id: request.id, result })
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
    return
  }

  if (request.kind === 'repl-reset') {
    replSession?.reset()
    postResponse({ kind: 'repl-ack', id: request.id })
  }
})

const postResponse = (response: WorkerResponse): void => {
  try {
    postToMain(response)
  } catch {
    // The payload contained a value that cannot be structured-cloned (for
    // example a function returned by user code); retry with previews so the
    // main thread still learns how the run ended.
    if (response.kind === 'result') {
      postToMain({ ...response, result: judgeResultWithPreviews(response.result) })
    } else if (response.kind === 'repl-result') {
      postToMain({ ...response, result: replResultWithPreviews(response.result) })
    }
  }
}

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
