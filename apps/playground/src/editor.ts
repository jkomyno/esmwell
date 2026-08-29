import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { linter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, Transaction, type Extension } from '@codemirror/state'
import {
  Decoration,
  activateHover,
  closeHoverTooltip,
  drawSelection,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  placeholder,
  ViewPlugin,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { tags, type Tag } from '@lezer/highlight'
import { ReplCommandHistory } from './repl-command-history'
import type { SourceLanguage, TypeScriptDisplayPart } from './typescript-protocol'
import type { TypeScriptClient } from './typescript-client'

const syntaxColors = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-literal)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syntax-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syntax-function)' },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: 'var(--syntax-variable)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },
  { tag: [tags.comment, tags.docComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'var(--syntax-punctuation)' },
  { tag: tags.invalid, color: 'var(--crimson)', textDecoration: 'underline' },
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--graphite)',
    backgroundColor: 'var(--paper-sunk)',
    fontSize: '0.8125rem',
  },
  '&.cm-focused': { outline: '2px solid var(--rust)', outlineOffset: '2px' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontStretch: 'var(--editor-font-stretch)',
    lineHeight: '1.65',
    fontVariantLigatures: 'none',
  },
  '.cm-content': { padding: 'var(--space-snug) 0', caretColor: 'var(--graphite)' },
  '.cm-line': { padding: '0 var(--space-snug)' },
  '.cm-gutters': {
    backgroundColor: 'var(--paper-sunk)',
    color: 'var(--graphite-soft)',
    borderRight: '1px solid var(--rule)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-tight) 0 var(--space-snug)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-selection-match)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--graphite)' },
  '.cm-tooltip, .cm-panels': {
    backgroundColor: 'var(--paper-raised)',
    color: 'var(--graphite)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 6px 20px -8px oklch(28% 0.014 70 / 0.22)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
  },
  '.cm-tooltip-autocomplete > ul > li': { padding: '0.25rem var(--space-tight)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--editor-selection)',
    color: 'var(--graphite)',
  },
  '.cm-completionLabel': { color: 'var(--graphite)' },
  '.cm-completionDetail': { color: 'var(--graphite-soft)', fontStyle: 'normal' },
  '.cm-typescript-info': {
    maxWidth: 'min(34rem, calc(100vw - 2.5rem))',
    maxHeight: 'min(20rem, 50vh)',
    overflow: 'auto',
    padding: 'var(--space-tight) var(--space-snug)',
  },
  '.cm-typescript-info code': { display: 'block', whiteSpace: 'pre-wrap' },
  '.cm-typescript-info p': {
    margin: 'var(--space-tight) 0 0',
    color: 'var(--graphite-soft)',
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.5',
  },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--crimson)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--crimson)' },
  '.cm-placeholder': { color: 'var(--graphite-soft)', fontStyle: 'normal' },
})

const activeLineDecoration = Decoration.line({ class: 'cm-activeLine' })

const highlightActiveCursorLines = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none

    constructor(view: EditorView) {
      this.decorations = this.getDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet) {
        this.decorations = this.getDecorations(update.view)
      }
    }

    private getDecorations(view: EditorView) {
      const lines = new Set<number>()
      for (const range of view.state.selection.ranges) {
        if (range.empty) {
          lines.add(view.lineBlockAt(range.head).from)
        }
      }
      return Decoration.set(
        [...lines].toSorted((left, right) => left - right).map((from) => activeLineDecoration.range(from)),
      )
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const languageExtension = (language: SourceLanguage): Extension => javascript({ typescript: language === 'ts' })

const quickInfoTokenTags: Readonly<Record<string, Tag>> = {
  aliasName: tags.typeName,
  className: tags.typeName,
  enumMemberName: tags.propertyName,
  enumName: tags.typeName,
  fieldName: tags.propertyName,
  functionName: tags.function(tags.variableName),
  interfaceName: tags.typeName,
  keyword: tags.keyword,
  localName: tags.variableName,
  methodName: tags.function(tags.propertyName),
  moduleName: tags.namespace,
  numericLiteral: tags.number,
  operator: tags.punctuation,
  parameterName: tags.variableName,
  propertyName: tags.propertyName,
  punctuation: tags.punctuation,
  regularExpressionLiteral: tags.string,
  stringLiteral: tags.string,
  typeParameterName: tags.typeName,
}

const quickInfoDom = (
  displayParts: readonly TypeScriptDisplayPart[],
  documentation: string,
): { readonly dom: HTMLElement } => {
  const dom = document.createElement('div')
  dom.className = 'cm-typescript-info'
  dom.setAttribute('role', 'tooltip')
  dom.setAttribute('aria-live', 'polite')
  const signature = document.createElement('code')
  for (const part of displayParts) {
    const token = document.createElement('span')
    token.textContent = part.text
    const tokenTag = quickInfoTokenTags[part.kind]
    const tokenClass = tokenTag === undefined ? null : syntaxColors.style([tokenTag])
    if (tokenClass !== null) {
      token.className = tokenClass
    }
    signature.append(token)
  }
  dom.append(signature)
  if (documentation !== '') {
    const description = document.createElement('p')
    description.textContent = documentation
    dom.append(description)
  }
  return { dom }
}

const replaceDocument = (view: EditorView, value: string): void => {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    selection: { anchor: value.length },
  })
}

const replaceSourceDocument = (view: EditorView, value: string, sourceHistory: Compartment): void => {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    selection: { anchor: value.length },
    annotations: Transaction.addToHistory.of(false),
    effects: sourceHistory.reconfigure([]),
  })
  // A language switch or source restore starts a new source undo history.
  view.dispatch({ effects: sourceHistory.reconfigure(history()) })
}

const REPL_SUGGESTION = "solve({ name: 'repl', age: 5 })"

interface SourceEditorOptions {
  readonly parent: HTMLElement
  readonly doc: string
  readonly language: SourceLanguage
  readonly typescript: TypeScriptClient
  readonly completionSource: CompletionSource
  readonly onChange: () => void
  readonly onRun: () => void
}

export interface SourceEditor {
  getValue(): string
  setValue(value: string): void
  setLanguage(language: SourceLanguage): void
  focus(): void
  destroy(): void
}

export const createSourceEditor = (options: SourceEditorOptions): SourceEditor => {
  let currentLanguage = options.language
  const language = new Compartment()
  const sourceHistory = new Compartment()
  const typeInfoTooltip = hoverTooltip(
    async (editor, position) => {
      const info = await options.typescript.quickInfo(editor.state.doc.toString(), currentLanguage, position)
      if (info === null) {
        return null
      }
      return {
        pos: info.from,
        end: info.to,
        above: true,
        create: () => quickInfoDom(info.displayParts, info.documentation),
      }
    },
    { hideOnChange: true },
  )
  const runKeybinding: KeyBinding = {
    key: 'Mod-Enter',
    preventDefault: true,
    run: () => {
      options.onRun()
      return true
    },
  }
  const typeInfoKeybinding: KeyBinding = {
    key: 'Mod-Shift-h',
    preventDefault: true,
    run: (editor) => {
      activateHover(editor, editor.state.selection.main.head, 1, {
        tooltip: typeInfoTooltip,
        until: (transaction) => transaction.docChanged || transaction.selection !== undefined,
      })
      return true
    },
  }
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        sourceHistory.of(history()),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        highlightActiveCursorLines,
        EditorState.tabSize.of(2),
        indentUnit.of('  '),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': 'Module source',
          'aria-describedby': 'editor-shortcuts',
          'aria-keyshortcuts': 'Meta+Shift+H Control+Shift+H',
          spellcheck: 'false',
        }),
        keymap.of([
          runKeybinding,
          typeInfoKeybinding,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        language.of(languageExtension(currentLanguage)),
        EditorState.languageData.of(() => [{ autocomplete: options.completionSource }]),
        linter((editor) => options.typescript.diagnostics(editor.state.doc.toString(), currentLanguage), {
          delay: 500,
        }),
        typeInfoTooltip,
        syntaxHighlighting(syntaxColors),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.onChange()
          }
        }),
      ],
    }),
  })
  return {
    getValue: () => view.state.doc.toString(),
    setValue(value) {
      if (value !== view.state.doc.toString()) {
        replaceSourceDocument(view, value, sourceHistory)
      }
    },
    setLanguage(nextLanguage) {
      currentLanguage = nextLanguage
      view.dispatch({
        effects: [language.reconfigure(languageExtension(nextLanguage)), closeHoverTooltip(typeInfoTooltip)],
      })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}

interface ReplEditorOptions {
  readonly parent: HTMLElement
  readonly language: SourceLanguage
  readonly completionSource: CompletionSource
  readonly onSubmit: (input: string) => void
}

export interface ReplEditor {
  setLanguage(language: SourceLanguage): void
  focus(): void
  destroy(): void
}

export const createReplEditor = (options: ReplEditorOptions): ReplEditor => {
  const commandHistory = new ReplCommandHistory()
  const language = new Compartment()
  const setHistoryValue = (view: EditorView, value: string | undefined): boolean => {
    if (value === undefined) {
      return false
    }
    replaceDocument(view, value)
    return true
  }
  const commandKeys: readonly KeyBinding[] = [
    {
      key: 'Enter',
      preventDefault: true,
      run: (view) => {
        const input = view.state.doc.toString().trim()
        if (input === '') {
          return true
        }
        commandHistory.push(input)
        replaceDocument(view, '')
        options.onSubmit(input)
        return true
      },
    },
    {
      key: 'ArrowUp',
      run: (view) => setHistoryValue(view, commandHistory.previous(view.state.doc.toString())),
    },
    {
      key: 'ArrowDown',
      run: (view) => setHistoryValue(view, commandHistory.next()),
    },
    {
      key: 'ArrowRight',
      run: (view) => {
        if (view.state.doc.length !== 0) {
          return false
        }
        replaceDocument(view, REPL_SUGGESTION)
        return true
      },
    },
  ]
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      extensions: [
        history(),
        closeBrackets(),
        autocompletion(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': 'REPL input',
          'aria-describedby': 'repl-shortcuts',
          spellcheck: 'false',
        }),
        placeholder(REPL_SUGGESTION),
        Prec.highest(keymap.of([...completionKeymap, ...commandKeys])),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        language.of(languageExtension(options.language)),
        EditorState.languageData.of(() => [{ autocomplete: options.completionSource }]),
        syntaxHighlighting(syntaxColors),
        editorTheme,
      ],
    }),
  })
  return {
    setLanguage(nextLanguage) {
      view.dispatch({ effects: language.reconfigure(languageExtension(nextLanguage)) })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
