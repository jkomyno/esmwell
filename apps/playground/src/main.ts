import { adaptWorker, collectBareSpecifiers, createRunesm, parseUserModule } from 'runesm'
import type { ConsoleChunk, JudgeCase, JudgeRunResult } from 'runesm'
import RunesmWorker from './runesm-worker?worker'
import { DEFAULT_CODE, DEMO_CASES } from './examples'

const editor = document.querySelector<HTMLTextAreaElement>('#editor')
const depsList = document.querySelector<HTMLUListElement>('#deps-list')
const runButton = document.querySelector<HTMLButtonElement>('#run')
const judgeButton = document.querySelector<HTMLButtonElement>('#judge')
const statusLabel = document.querySelector<HTMLSpanElement>('#status')
const consoleView = document.querySelector<HTMLDivElement>('#console')
const casesView = document.querySelector<HTMLDivElement>('#cases')

if (
  editor === null ||
  depsList === null ||
  runButton === null ||
  judgeButton === null ||
  statusLabel === null ||
  consoleView === null ||
  casesView === null
) {
  throw new Error('playground markup is missing required elements')
}

const collectPinnedDeps = (): Record<string, string> => {
  const deps: Record<string, string> = {}
  for (const input of depsList.querySelectorAll<HTMLInputElement>('input[data-pkg]')) {
    const version = input.value.trim()
    if (version !== '') {
      deps[input.dataset.pkg ?? ''] = version
    }
  }
  return deps
}

function createSession() {
  return createRunesm({
    workerFactory: () => adaptWorker(new RunesmWorker()),
    deps: collectPinnedDeps(),
    timeoutMs: 10_000,
  })
}

let session = createSession()

const setStatus = (text: string, tone: 'idle' | 'running' | 'ok' | 'fail'): void => {
  statusLabel.textContent = text
  statusLabel.dataset.tone = tone
}

const appendConsoleLine = (chunk: ConsoleChunk): void => {
  const line = document.createElement('div')
  line.className = `line line-${chunk.level}`
  line.textContent = chunk.parts.join(' ')
  consoleView.append(line)
}

const renderCases = (result: JudgeRunResult): void => {
  casesView.replaceChildren()
  for (const caseResult of result.cases) {
    const row = document.createElement('div')
    row.className = `case case-${caseResult.status}`

    const title = document.createElement('span')
    title.className = 'case-name'
    title.textContent = caseResult.name
    row.append(title)

    const badge = document.createElement('span')
    badge.className = 'case-status'
    badge.textContent = caseResult.status
    row.append(badge)

    if (caseResult.status === 'fail' && 'actual' in caseResult) {
      const detail = document.createElement('div')
      detail.className = 'case-detail'
      detail.textContent = `expected ${formatValue(caseResult.expected)} — got ${formatValue(caseResult.actual)}`
      row.append(detail)
    }
    if (caseResult.status === 'error' && caseResult.error !== undefined) {
      const detail = document.createElement('div')
      detail.className = 'case-detail'
      detail.textContent = caseResult.error.message
      row.append(detail)
    }
    casesView.append(row)
  }
}

const formatValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const renderResult = (result: JudgeRunResult): void => {
  for (const chunk of result.console) {
    appendConsoleLine(chunk)
  }
  renderCases(result)

  if (result.error !== undefined) {
    const errorLine = document.createElement('div')
    errorLine.className = 'line line-error'
    errorLine.textContent = `${result.error.name}: ${result.error.message}`
    consoleView.append(errorLine)
  }
  const depsLine = document.createElement('div')
  depsLine.className = 'line line-deps'
  depsLine.textContent =
    result.dependencies.length > 0
      ? `deps: ${result.dependencies.map((dep) => `${dep.name}@${dep.version}`).join(', ')}`
      : 'deps: none'
  consoleView.append(depsLine)

  setStatus(
    result.status === 'pass' ? `ok in ${result.durationMs}ms` : `${result.status} in ${result.durationMs}ms`,
    result.status === 'pass' ? 'ok' : 'fail',
  )
}

const execute = async (cases: readonly JudgeCase[]): Promise<void> => {
  consoleView.replaceChildren()
  casesView.replaceChildren()
  setStatus('running…', 'running')
  session.close()
  session = createSession()
  try {
    const result = await session.runJudge(editor.value, cases)
    renderResult(result)
  } catch (error) {
    setStatus('failed', 'fail')
    const line = document.createElement('div')
    line.className = 'line line-error'
    line.textContent = String(error)
    consoleView.append(line)
  }
}

runButton.addEventListener('click', () => {
  void execute([])
})

judgeButton.addEventListener('click', () => {
  void execute(DEMO_CASES)
})

const refreshDeps = (): void => {
  let specifiers: string[]
  try {
    specifiers = collectBareSpecifiersFromCode(editor.value)
  } catch {
    // Syntax errors while typing are fine: keep the previous dep list.
    return
  }
  const previous = collectPinnedDeps()
  depsList.replaceChildren()
  if (specifiers.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'dep-empty'
    empty.textContent = 'no imports detected'
    depsList.append(empty)
    return
  }
  for (const specifier of specifiers) {
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

    const item = document.createElement('li')
    item.className = 'dep'

    const name = document.createElement('span')
    name.className = 'dep-name'
    name.textContent = specifier
    item.append(name)

    const version = document.createElement('input')
    version.type = 'text'
    version.dataset.pkg = packageName
    version.placeholder = 'latest'
    version.value = previous[packageName] ?? ''
    version.setAttribute('aria-label', `version pin for ${packageName}`)
    item.append(version)

    depsList.append(item)
  }
}

const collectBareSpecifiersFromCode = (code: string): string[] => collectBareSpecifiers(parseUserModule(code))

editor.value = DEFAULT_CODE
editor.addEventListener('input', () => {
  refreshDeps()
})
refreshDeps()
setStatus('idle', 'idle')
