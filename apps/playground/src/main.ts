import {
  adaptWorker,
  collectBareSpecifiers,
  createReplSession,
  createRunesm,
  parseUserModule,
  resolveImportSpecifier,
} from 'runesm'
import type {
  ConsoleChunk,
  JudgeCase,
  JudgeCaseResult,
  JudgeRunResult,
  ReplResult,
  ReplSession,
  ResolvedDependency,
  SerializedError,
} from 'runesm'
import { createReplEditor, createSourceEditor, type ReplEditor, type SourceEditor } from './editor'
import RunesmExecutionWorkerUrl from './runesm-execution-worker?worker&url'
import RunesmWorker from './runesm-worker?worker'
import { DEFAULT_CODE, DEMO_CASES } from './examples'
import { TypeScriptClient, TypeScriptCompileError } from './typescript-client'
import type { SourceLanguage } from './typescript-protocol'

const editor = document.querySelector<HTMLDivElement>('#editor')
const depsList = document.querySelector<HTMLUListElement>('#deps-list')
const runButton = document.querySelector<HTMLButtonElement>('#run')
const judgeButton = document.querySelector<HTMLButtonElement>('#judge')
const tape = document.querySelector<HTMLParagraphElement>('#tape')
const faultView = document.querySelector<HTMLDivElement>('#fault')
const consoleView = document.querySelector<HTMLDivElement>('#console')
const casesView = document.querySelector<HTMLUListElement>('#cases')
const replHistory = document.querySelector<HTMLDivElement>('#repl-history')
const replInput = document.querySelector<HTMLDivElement>('#repl-input')
const replResetButton = document.querySelector<HTMLButtonElement>('#repl-reset')
const languageButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-language]')]

if (
  editor === null ||
  depsList === null ||
  runButton === null ||
  judgeButton === null ||
  tape === null ||
  faultView === null ||
  consoleView === null ||
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
const REPL_EMPTY = 'Editor declarations load first. Later values persist until reset or the editor changes.'
const typescriptClient = new TypeScriptClient()
let sourceLanguage: SourceLanguage = 'ts'
let sourceEditor: SourceEditor
let replEditor: ReplEditor

const currentSource = (): string => sourceEditor.getValue()

const executableSource = (source = currentSource(), language = sourceLanguage): Promise<string> =>
  language === 'ts' ? typescriptClient.transpile(source) : Promise.resolve(source)

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
    executionWorkerUrl: RunesmExecutionWorkerUrl,
    deps: collectPinnedDeps(),
    timeoutMs: 10_000,
  })
}

let session = createSession()

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

judgeButton.textContent = `Judge ${countLabel(DEMO_CASES.length, 'case', 'cases')}`

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

const FAULT_KINDS: Readonly<Record<string, string>> = {
  UserSyntaxError: 'Syntax error',
  PolicyViolation: 'Policy violation',
  SpecifierResolutionError: 'Unresolved import',
  TimeoutError: 'Timed out',
  TypeScriptError: 'TypeScript error',
}

const serializeThrown = (error: unknown): SerializedError => {
  if (error instanceof TypeScriptCompileError) {
    return { name: error.name, message: error.message, line: error.line, column: error.column }
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  return { name: 'Error', message: String(error) }
}

/**
 * The location detail the error's own message does not already carry. A
 * resolution failure names its specifier and reason itself, so it gets nothing.
 */
const describeWhere = (error: SerializedError): string | undefined => {
  if (error.specifier !== undefined) {
    return undefined
  }
  if (error.rule !== undefined && error.line !== undefined) {
    return `Rule ${error.rule}, line ${error.line}.`
  }
  if (error.line !== undefined && error.column !== undefined) {
    return `Line ${error.line}, column ${error.column + 1}.`
  }
  if (error.line !== undefined) {
    return `Line ${error.line}.`
  }
  return undefined
}

const renderFault = (error: SerializedError, showLocation = true): void => {
  const nodes: HTMLElement[] = [el('p', 'fault-kind', FAULT_KINDS[error.name] ?? error.name)]
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

/* ------------------------------------------------------------------
   Resolved dependencies. Rust as content, and the only place it
   appears as content anywhere in the interface.
   ------------------------------------------------------------------ */

const showResolvedDeps = (dependencies: readonly ResolvedDependency[]): void => {
  const versions = new Map(dependencies.map((dependency) => [dependency.name, dependency.version]))
  for (const row of depsList.querySelectorAll<HTMLLIElement>('li[data-pkg]')) {
    const slot = row.querySelector<HTMLSpanElement>('.dep-resolved')
    const version = versions.get(row.dataset.pkg ?? '')
    if (slot !== null) {
      slot.textContent = version === undefined ? '' : `@${version}`
    }
  }
}

const renderResult = (result: JudgeRunResult, showLocation: boolean): void => {
  if (result.error !== undefined) {
    renderFault(result.error, showLocation)
  }
  renderCases(result.cases)
  showResolvedDeps(result.dependencies)

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
  showResolvedDeps([])
  renderTape('running', 'running', [])
  session.close()
  session = createSession()
  const language = sourceLanguage
  try {
    const source = await executableSource(currentSource(), language)
    const result = await session.runJudge(source, cases, { onConsoleChunk: appendConsoleLine })
    renderResult(result, language === 'mjs')
  } catch (error) {
    // runesm sees emitted JavaScript in .ts mode, so only compiler diagnostics
    // can truthfully point back to the source currently shown in the editor.
    renderFault(serializeThrown(error), language === 'mjs' || error instanceof TypeScriptCompileError)
    renderTape('error', 'fail', [])
  } finally {
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
   REPL: the editor module seeds one persistent worker scope. Editing
   source or dependency pins discards it so the next input reloads.
   ------------------------------------------------------------------ */

let replSession: ReplSession | null = null
let replReady: Promise<ReplSession> | null = null
let replGeneration = 0
const replContextInputs: string[] = []
let replCompletionPrefix = ''

const refreshReplCompletionPrefix = (): void => {
  replCompletionPrefix = `${currentSource()}\n${replContextInputs.join('\n')}\n`
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
    const source = currentSource()
    const language = sourceLanguage
    const nextSession = createReplSession({
      workerFactory: () => adaptWorker(new RunesmWorker()),
      executionWorkerUrl: RunesmExecutionWorkerUrl,
      deps: collectPinnedDeps(),
      timeoutMs: 10_000,
    })
    replSession = nextSession
    replReady = executableSource(source, language)
      .then((compiledSource) => {
        if (generation !== replGeneration) {
          nextSession.close()
          throw new Error('the editor changed while its module was loading; run the command again')
        }
        return nextSession.evaluate(compiledSource, {
          onConsoleChunk: (chunk) => {
            if (generation === replGeneration) {
              appendReplConsole(chunk)
            }
          },
        })
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
  const language = sourceLanguage
  appendReplLine('input', '›', input)
  try {
    const [readySession, compiledInput] = await Promise.all([getReplSession(), executableSource(input, language)])
    if (generation !== replGeneration) {
      return
    }
    const result = await readySession.evaluate(compiledInput, {
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

/* ------------------------------------------------------------------
   Deps list, rebuilt from the imports the editor currently declares.
   ------------------------------------------------------------------ */

const collectBareSpecifiersFromCode = (code: string): string[] => collectBareSpecifiers(parseUserModule(code))

/**
 * Groups the editor's specifiers by the package they belong to. Pins are per
 * package, and an inline tag like `effect@beta/Console` is not part of the
 * package name, so runesm's own resolver does the naming. Specifiers it cannot
 * resolve at all are not pinnable; the run reports them as a fault.
 */
const groupByPackage = (specifiers: readonly string[]): Map<string, string[]> => {
  const groups = new Map<string, string[]>()
  for (const specifier of specifiers) {
    let name: string | undefined
    try {
      name = resolveImportSpecifier(specifier, { autoInstall: true }).dependency?.name
    } catch {
      continue
    }
    if (name === undefined) {
      continue
    }
    const group = groups.get(name)
    if (group === undefined) {
      groups.set(name, [specifier])
    } else if (!group.includes(specifier)) {
      group.push(specifier)
    }
  }
  return groups
}

let depsRefreshGeneration = 0
let depsRefreshTimer: ReturnType<typeof setTimeout> | undefined
let renderedDepsSignature: string | undefined

const refreshDeps = async (): Promise<void> => {
  const generation = ++depsRefreshGeneration
  let specifiers: string[]
  try {
    specifiers = collectBareSpecifiersFromCode(await executableSource())
  } catch {
    // Syntax errors while typing are fine: keep the previous dep list.
    return
  }
  if (generation !== depsRefreshGeneration) {
    return
  }
  const previous = collectPinnedDeps()

  const groups = groupByPackage(specifiers)
  const signature = JSON.stringify([...groups])
  if (signature === renderedDepsSignature) {
    return
  }
  renderedDepsSignature = signature
  if (groups.size === 0) {
    depsList.replaceChildren(
      el('li', 'dep-empty well-empty', 'No bare imports yet. Import a package and it shows up here.'),
    )
    return
  }

  const rows = [...groups].map(([packageName, packageSpecifiers], index) => {
    const inputId = `dep-pin-${index}`

    const row = el('li', 'dep')
    row.dataset.pkg = packageName

    const label = document.createElement('label')
    label.className = 'dep-name'
    label.htmlFor = inputId
    label.append(packageName, el('span', 'sr-only', ' version pin'))

    const version = document.createElement('input')
    version.id = inputId
    version.type = 'text'
    version.dataset.pkg = packageName
    version.placeholder = 'latest'
    version.value = previous[packageName] ?? ''
    version.addEventListener('change', () => {
      resetRepl()
    })

    row.append(label, el('span', 'dep-resolved'), version)

    // Only worth showing when a specifier says more than the package name does,
    // which is exactly when a subpath or an inline tag is doing something.
    const detailed = packageSpecifiers.filter((specifier) => specifier !== packageName)
    if (detailed.length > 0) {
      row.append(el('p', 'dep-specifiers', detailed.join('  ')))
    }
    return row
  })
  depsList.replaceChildren(...rows)
}

const scheduleDepsRefresh = (): void => {
  clearTimeout(depsRefreshTimer)
  depsRefreshTimer = setTimeout(() => void refreshDeps(), 160)
}

const resetRepl = (): void => {
  discardReplSession()
  replHistory.replaceChildren(emptyLine(REPL_EMPTY))
}

const updateLanguageButtons = (): void => {
  for (const button of languageButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === sourceLanguage))
  }
}

sourceEditor = createSourceEditor({
  parent: editor,
  doc: DEFAULT_CODE,
  language: sourceLanguage,
  typescript: typescriptClient,
  completionSource: typescriptClient.completionSource(() => ({ prefix: '', language: sourceLanguage })),
  onChange: () => {
    resetRepl()
    scheduleDepsRefresh()
  },
  onRun: () => void execute([]),
})
refreshReplCompletionPrefix()

replEditor = createReplEditor({
  parent: replInput,
  language: sourceLanguage,
  completionSource: typescriptClient.completionSource(() => ({
    prefix: replCompletionPrefix,
    language: sourceLanguage,
  })),
  onSubmit: (input) => void submitRepl(input),
})

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    const nextLanguage = button.dataset.language
    if ((nextLanguage !== 'ts' && nextLanguage !== 'mjs') || nextLanguage === sourceLanguage) {
      return
    }
    sourceLanguage = nextLanguage
    sourceEditor.setLanguage(nextLanguage)
    replEditor.setLanguage(nextLanguage)
    updateLanguageButtons()
    resetRepl()
    void refreshDeps()
  })
}

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

updateLanguageButtons()
void refreshDeps()
consoleView.replaceChildren(emptyLine(CONSOLE_EMPTY))
replHistory.replaceChildren(emptyLine(REPL_EMPTY))
renderTape('idle', 'idle', [])
