import { adaptWorker, createReplSession, createRunesm } from 'runesm'
import type {
  ConsoleChunk,
  JudgeCase,
  JudgeCaseResult,
  JudgeRunResult,
  ReplResult,
  ReplSession,
  SerializedError,
  SourceTransform,
} from 'runesm'
import { createReplEditor, createSourceEditor, type ReplEditor, type SourceEditor } from './editor'
import RunesmExecutionWorkerUrl from './runesm-execution-worker?worker&url'
import RunesmWorker from './runesm-worker?worker'
import { DEFAULT_CODE, DEMO_CASES } from './examples'
import { describeWhere, faultKind, serializeThrown } from './fault'
import { SourceLanguageState } from './source-language-state'
import { TypeScriptClient } from './typescript-client'
import type { SourceLanguage } from './typescript-protocol'

const editor = document.querySelector<HTMLDivElement>('#editor')
const runButton = document.querySelector<HTMLButtonElement>('#run')
const judgeButton = document.querySelector<HTMLButtonElement>('#judge')
const sourceResetButton = document.querySelector<HTMLButtonElement>('#source-reset')
const sourceStatus = document.querySelector<HTMLParagraphElement>('#source-status')
const editorCursor = document.querySelector<HTMLParagraphElement>('#editor-cursor')
const testDefinitions = document.querySelector<HTMLOListElement>('#test-definitions')
const testCount = document.querySelector<HTMLSpanElement>('#test-count')
const tape = document.querySelector<HTMLParagraphElement>('#tape')
const faultView = document.querySelector<HTMLDivElement>('#fault')
const consoleView = document.querySelector<HTMLDivElement>('#console')
const resultsView = document.querySelector<HTMLDivElement>('#results')
const resultsEmpty = document.querySelector<HTMLParagraphElement>('#results-empty')
const casesView = document.querySelector<HTMLUListElement>('#cases')
const replHistory = document.querySelector<HTMLDivElement>('#repl-history')
const replInput = document.querySelector<HTMLDivElement>('#repl-input')
const replResetButton = document.querySelector<HTMLButtonElement>('#repl-reset')
const languageButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-language]')]

if (
  editor === null ||
  runButton === null ||
  judgeButton === null ||
  sourceResetButton === null ||
  sourceStatus === null ||
  editorCursor === null ||
  testDefinitions === null ||
  testCount === null ||
  tape === null ||
  faultView === null ||
  consoleView === null ||
  resultsView === null ||
  resultsEmpty === null ||
  casesView === null ||
  replHistory === null ||
  replInput === null ||
  replResetButton === null ||
  languageButtons.length !== 2
) {
  throw new Error('playground markup is missing required elements')
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

/** A single line of graphite-soft prose, so a well is never a blank box. */
const emptyLine = (text: string): HTMLParagraphElement => el('p', 'well-empty', text)

const CONSOLE_EMPTY = 'Console output from your module appears here as it runs.'
const RESULTS_EMPTY = 'Case results appear here after Run tests.'
const REPL_EMPTY = 'Editor declarations load first. Later values persist until reset or the editor changes.'
const typescriptClient = new TypeScriptClient()
const sourceState = new SourceLanguageState(DEFAULT_CODE)
let sourceEditor: SourceEditor
let replEditor: ReplEditor
let replacingEditorSource = false
let switchingLanguage = false
let sourceTransitionStatus: { readonly message: string; readonly tone: 'notice' | 'error' } | undefined

// In .ts mode the session compiles through the language-service worker on
// its way to runesm; .mjs is already the JavaScript the runner executes.
const transformFor = (language: SourceLanguage): SourceTransform | undefined =>
  language === 'ts' ? (source) => typescriptClient.transpile(source) : undefined

function createSession(language: SourceLanguage) {
  return createRunesm({
    workerFactory: () => adaptWorker(new RunesmWorker()),
    executionWorkerUrl: RunesmExecutionWorkerUrl,
    timeoutMs: 10_000,
    transform: transformFor(language),
  })
}

let session = createSession(sourceState.language)

/* ------------------------------------------------------------------
   Run tape: status word, duration, and how many deps actually
   resolved. Status is carried by the word, never by hue alone.
   ------------------------------------------------------------------ */

type Tone = 'idle' | 'running' | 'ok' | 'fail'

const renderTape = (status: string, tone: Tone, facts: readonly string[]): void => {
  const word = el('span', 'tape-status', status)
  word.dataset.tone = tone
  const nodes: HTMLElement[] = [word]
  for (const fact of facts) {
    const separator = el('span', 'tape-sep', '·')
    separator.setAttribute('aria-hidden', 'true')
    nodes.push(separator, el('span', 'tape-fact', fact))
  }
  tape.replaceChildren(...nodes)
}

const countLabel = (count: number, singular: string, plural: string): string =>
  count === 1 ? `1 ${singular}` : `${count} ${plural}`

/* ------------------------------------------------------------------
   Console
   ------------------------------------------------------------------ */

const appendConsoleLine = (chunk: ConsoleChunk): void => {
  if (consoleView.firstElementChild?.classList.contains('well-empty') === true) {
    consoleView.replaceChildren()
  }
  consoleView.append(el('div', `line line-${chunk.level}`, chunk.parts.join(' ')))
  consoleView.scrollTop = consoleView.scrollHeight
}

/* ------------------------------------------------------------------
   Fault: a module-level failure rendered as an outcome with enough
   detail to act on, using the structured fields the error carries.
   ------------------------------------------------------------------ */

const renderFault = (error: SerializedError, showLocation = true): void => {
  const nodes: HTMLElement[] = [el('p', 'fault-kind', faultKind(error))]
  nodes.push(el('p', 'fault-message', error.message))
  const where = showLocation ? describeWhere(error) : undefined
  if (where !== undefined) {
    nodes.push(el('p', 'fault-where', where))
  }
  faultView.replaceChildren(...nodes)
  faultView.hidden = false
}

const clearFault = (): void => {
  faultView.replaceChildren()
  faultView.hidden = true
}

/** The results region is never blank: the empty line yields only to rows or a fault. */
const syncResultsEmpty = (): void => {
  resultsEmpty.hidden = !faultView.hidden || casesView.childElementCount > 0
}

/* ------------------------------------------------------------------
   Case rows
   ------------------------------------------------------------------ */

const formatValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const renderTestDefinitions = (): void => {
  const rows = DEMO_CASES.map((testCase) => {
    const row = el('li', 'test-definition')
    const invocation = `${testCase.exportName}(${(testCase.args ?? []).map(formatValue).join(', ')})`
    const expectation = Object.hasOwn(testCase, 'expected')
      ? `expects ${formatValue(testCase.expected)}`
      : 'passes if it does not throw'
    row.append(
      el('span', 'test-name', testCase.name),
      el('code', 'test-invocation', invocation),
      el('span', 'test-expectation', expectation),
    )
    return row
  })
  testDefinitions.replaceChildren(...rows)
  testCount.textContent = String(rows.length)
  // Reserve the results height up front, so passing rows never shift the REPL.
  resultsView.style.setProperty('--case-rows', String(Math.max(rows.length, 1)))
}

const caseDetail = (caseResult: JudgeCaseResult): string | undefined => {
  if (caseResult.status === 'fail') {
    return `expected ${formatValue(caseResult.expected)}, got ${formatValue(caseResult.actual)}`
  }
  if (caseResult.status === 'error' && caseResult.error !== undefined) {
    return `${caseResult.error.name}: ${caseResult.error.message}`
  }
  return undefined
}

const renderCases = (cases: readonly JudgeCaseResult[]): void => {
  const rows = cases.map((caseResult) => {
    const row = el('li', `case case-${caseResult.status}`)
    row.append(
      el('span', 'case-name', caseResult.name),
      el('span', 'case-duration', `${caseResult.durationMs} ms`),
      el('span', 'case-status', caseResult.status),
    )
    const detail = caseDetail(caseResult)
    if (detail !== undefined) {
      row.append(el('p', 'case-detail', detail))
    }
    return row
  })
  casesView.replaceChildren(...rows)
}

const renderResult = (result: JudgeRunResult, showLocation: boolean): void => {
  if (result.error !== undefined) {
    renderFault(result.error, showLocation)
  }
  renderCases(result.cases)

  const facts = [`${result.durationMs} ms`, countLabel(result.dependencies.length, 'dep', 'deps')]
  renderTape(result.status, result.status === 'pass' ? 'ok' : 'fail', facts)
}

/** True while a run is in flight, so a second click cannot close a session that still owns one. */
let running = false

const execute = async (cases: readonly JudgeCase[]): Promise<void> => {
  if (running) {
    return
  }
  running = true
  runButton.disabled = true
  judgeButton.disabled = true
  clearFault()
  consoleView.replaceChildren(emptyLine(CONSOLE_EMPTY))
  casesView.replaceChildren()
  syncResultsEmpty()
  renderTape('running', 'running', [])
  const language = sourceState.language
  session.close()
  session = createSession(language)
  try {
    const result = await session.runJudge(sourceState.source, cases, { onConsoleChunk: appendConsoleLine })
    // runesm sees emitted JavaScript in .ts mode, so only compiler diagnostics
    // can truthfully point back to the source currently shown in the editor.
    renderResult(result, language === 'mjs' || result.error?.name === 'TypeScriptError')
  } catch (error) {
    renderFault(serializeThrown(error), false)
    renderTape('error', 'fail', [])
  } finally {
    syncResultsEmpty()
    running = false
    runButton.disabled = false
    judgeButton.disabled = false
  }
}

runButton.addEventListener('click', () => {
  void execute([])
})

judgeButton.addEventListener('click', () => {
  void execute(DEMO_CASES)
})

/* ------------------------------------------------------------------
   REPL: the editor module seeds one persistent worker scope. Editing,
   restoring, or changing source language discards it so the next input reloads.
   ------------------------------------------------------------------ */

let replSession: ReplSession | null = null
let replReady: Promise<ReplSession> | null = null
let replGeneration = 0
const replContextInputs: string[] = []
let replCompletionPrefix = ''

const refreshReplCompletionPrefix = (): void => {
  replCompletionPrefix = `${sourceState.source}\n${replContextInputs.join('\n')}\n`
}

const discardReplSession = (): void => {
  replGeneration += 1
  replSession?.close()
  replSession = null
  replReady = null
  replContextInputs.length = 0
  refreshReplCompletionPrefix()
}

const formatReplValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return `'${value}'`
  }
  return formatValue(value)
}

const appendReplLine = (variant: string, prefix: string, text: string): void => {
  if (replHistory.firstElementChild?.classList.contains('well-empty') === true) {
    replHistory.replaceChildren()
  }
  const line = el('div', `repl-line repl-line-${variant}`)
  const marker = el('span', 'repl-line-prefix', `${prefix} `)
  marker.setAttribute('aria-hidden', 'true')
  line.append(marker, document.createTextNode(text))
  replHistory.append(line)
  replHistory.scrollTop = replHistory.scrollHeight
}

const appendReplConsole = (chunk: ConsoleChunk): void => {
  appendReplLine('log', ' ', chunk.parts.join(' '))
}

const getReplSession = (): Promise<ReplSession> => {
  if (replReady === null) {
    const generation = replGeneration
    const source = sourceState.source
    const language = sourceState.language
    const nextSession = createReplSession({
      workerFactory: () => adaptWorker(new RunesmWorker()),
      executionWorkerUrl: RunesmExecutionWorkerUrl,
      timeoutMs: 10_000,
      transform: transformFor(language),
    })
    replSession = nextSession
    replReady = nextSession
      .evaluate(source, {
        onConsoleChunk: (chunk) => {
          if (generation === replGeneration) {
            appendReplConsole(chunk)
          }
        },
      })
      .then((result) => {
        if (generation !== replGeneration) {
          nextSession.close()
          throw new Error('the editor changed while its module was loading; run the command again')
        }
        if (!result.ok) {
          const detail = result.error === undefined ? 'unknown error' : `${result.error.name}: ${result.error.message}`
          throw new Error(`could not load the editor module into the REPL: ${detail}`)
        }
        return nextSession
      })
      .catch((error: unknown) => {
        if (replSession === nextSession) {
          discardReplSession()
        }
        throw error
      })
  }
  return replReady
}

const renderReplResult = (result: ReplResult): void => {
  if (result.error !== undefined) {
    appendReplLine('error', '!', `${result.error.name}: ${result.error.message}`)
    return
  }
  if ('value' in result && result.value !== undefined) {
    appendReplLine('value', '=', formatReplValue(result.value))
  }
}

const submitRepl = async (input: string): Promise<void> => {
  const generation = replGeneration
  appendReplLine('input', '›', input)
  try {
    const readySession = await getReplSession()
    if (generation !== replGeneration) {
      return
    }
    const result = await readySession.evaluate(input, {
      onConsoleChunk: (chunk) => {
        if (generation === replGeneration) {
          appendReplConsole(chunk)
        }
      },
    })
    if (generation !== replGeneration) {
      return
    }
    if (result.ok) {
      replContextInputs.push(input)
      refreshReplCompletionPrefix()
    }
    renderReplResult(result)
  } catch (error) {
    if (generation === replGeneration) {
      appendReplLine('error', '!', String(error))
    }
  }
}

replResetButton.addEventListener('click', () => {
  resetRepl()
  replEditor.focus()
})

const resetRepl = (): void => {
  discardReplSession()
  replHistory.replaceChildren(emptyLine(REPL_EMPTY))
}

const renderSourceControls = (): void => {
  for (const button of languageButtons) {
    const language = button.dataset.language
    button.setAttribute('aria-pressed', String(language === sourceState.language))
    button.disabled = switchingLanguage || (language === 'ts' && !sourceState.typeScriptAvailable)
  }
  sourceResetButton.disabled = switchingLanguage || !sourceState.dirty

  const status =
    sourceTransitionStatus?.message ??
    (sourceState.typeScriptAvailable ? undefined : 'JavaScript changed. Restore the initial source to return to .ts.')
  sourceStatus.hidden = status === undefined
  sourceStatus.textContent = status ?? ''
  sourceStatus.dataset.tone = sourceTransitionStatus?.tone ?? 'notice'
}

const renderVisibleSource = (): void => {
  replacingEditorSource = true
  try {
    sourceEditor.setLanguage(sourceState.language)
    sourceEditor.setValue(sourceState.source)
    replEditor.setLanguage(sourceState.language)
  } finally {
    replacingEditorSource = false
  }
}

const switchSourceLanguage = async (nextLanguage: SourceLanguage): Promise<void> => {
  if (switchingLanguage || nextLanguage === sourceState.language) {
    return
  }
  if (nextLanguage === 'ts') {
    if (!sourceState.showTypeScript()) {
      renderSourceControls()
      return
    }
    sourceTransitionStatus = undefined
    renderVisibleSource()
    renderSourceControls()
    resetRepl()
    return
  }

  sourceEditor.focus()
  switchingLanguage = true
  sourceTransitionStatus = undefined
  renderSourceControls()
  try {
    const result = await sourceState.showJavaScriptForCurrentTypeScript((source) => typescriptClient.transpile(source))
    if (result.status === 'shown') {
      renderVisibleSource()
      resetRepl()
    } else if (result.status === 'source-changed') {
      sourceTransitionStatus = {
        message: 'Source changed while generating .mjs. Open .mjs again to generate the latest JavaScript.',
        tone: 'notice',
      }
    } else {
      sourceTransitionStatus = {
        message: `Cannot open .mjs: ${serializeThrown(result.error).message}`,
        tone: 'error',
      }
    }
  } finally {
    switchingLanguage = false
    renderSourceControls()
  }
}

sourceEditor = createSourceEditor({
  parent: editor,
  doc: DEFAULT_CODE,
  language: sourceState.language,
  typescript: typescriptClient,
  completionSource: typescriptClient.completionSource(() => ({ prefix: '', language: sourceState.language })),
  onChange: () => {
    if (replacingEditorSource) {
      return
    }
    sourceState.edit(sourceEditor.getValue())
    sourceTransitionStatus = undefined
    renderSourceControls()
    resetRepl()
  },
  onCursor: ({ line, column }) => {
    editorCursor.textContent = `Ln ${line}, Col ${column}`
  },
  onRun: () => void execute([]),
})
refreshReplCompletionPrefix()
// Fetch the default module's declarations and check it once now, so the first
// hover answers from a warm checker. A failure here only means a slower first hover.
void typescriptClient.warm(DEFAULT_CODE, sourceState.language).catch(() => undefined)

replEditor = createReplEditor({
  parent: replInput,
  language: sourceState.language,
  completionSource: typescriptClient.completionSource(() => ({
    prefix: replCompletionPrefix,
    language: sourceState.language,
  })),
  onSubmit: (input) => void submitRepl(input),
})

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    const nextLanguage = button.dataset.language
    if (nextLanguage !== 'ts' && nextLanguage !== 'mjs') {
      return
    }
    void switchSourceLanguage(nextLanguage)
  })
}

sourceResetButton.addEventListener('click', () => {
  sourceState.reset()
  sourceTransitionStatus = undefined
  renderVisibleSource()
  sourceEditor.focus()
  renderSourceControls()
  resetRepl()
})

window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    return
  }
  sourceEditor.destroy()
  replEditor.destroy()
  typescriptClient.destroy()
  session.close()
  replSession?.close()
})

renderSourceControls()
renderTestDefinitions()
resultsEmpty.textContent = RESULTS_EMPTY
consoleView.replaceChildren(emptyLine(CONSOLE_EMPTY))
replHistory.replaceChildren(emptyLine(REPL_EMPTY))
renderTape('idle', 'idle', [])
