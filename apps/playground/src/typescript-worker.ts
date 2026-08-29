/// <reference lib="webworker" />

import * as ts from 'typescript-legacy'
import type {
  SourceLanguage,
  TypeScriptCompletion,
  TypeScriptCompletions,
  TypeScriptDiagnostic,
  TypeScriptQuickInfo,
  TypeScriptWorkerRequest,
  TypeScriptWorkerResponse,
} from './typescript-protocol'
import { serializeQuickInfo } from './typescript-quick-info'

const LIB_FILES = import.meta.glob<string>('../node_modules/typescript-legacy/lib/lib*.d.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
})

const libraries = new Map(
  Object.entries(LIB_FILES).map(([path, source]) => [`/${path.split('/').at(-1) ?? path}`, source]),
)

const sourceFileNames: Readonly<Record<SourceLanguage, string>> = {
  ts: '/playground.ts',
  mjs: '/playground.mjs',
}

let currentLanguage: SourceLanguage = 'ts'
let currentSource = ''
let sourceVersion = 0

const compilerOptions = (language: SourceLanguage): ts.CompilerOptions => ({
  allowJs: language === 'mjs',
  allowNonTsExtensions: true,
  checkJs: false,
  lib: ['lib.es2023.d.ts', 'lib.webworker.d.ts', 'lib.webworker.iterable.d.ts', 'lib.webworker.asynciterable.d.ts'],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: false,
  noEmitOnError: false,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2023,
  verbatimModuleSyntax: true,
})

const activeFileName = (): string => sourceFileNames[currentLanguage]

const sourceFor = (fileName: string): string | undefined => {
  if (fileName === activeFileName()) {
    return currentSource
  }
  const absolute = fileName.startsWith('/') ? fileName : `/${fileName}`
  return libraries.get(absolute)
}

const host: ts.LanguageServiceHost = {
  fileExists: (fileName) => sourceFor(fileName) !== undefined,
  getCompilationSettings: () => compilerOptions(currentLanguage),
  getCurrentDirectory: () => '/',
  getDefaultLibFileName: (options) => `/${ts.getDefaultLibFileName(options)}`,
  getNewLine: () => '\n',
  getProjectVersion: () => String(sourceVersion),
  getScriptFileNames: () => [activeFileName()],
  getScriptKind: (fileName) => (fileName.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS),
  getScriptSnapshot: (fileName) => {
    const source = sourceFor(fileName)
    return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source)
  },
  getScriptVersion: (fileName) => (fileName === activeFileName() ? String(sourceVersion) : '1'),
  readFile: sourceFor,
  useCaseSensitiveFileNames: () => true,
}

const languageService = ts.createLanguageService(host, ts.createDocumentRegistry())

const setSource = (source: string, language: SourceLanguage): void => {
  if (source === currentSource && language === currentLanguage) {
    return
  }
  currentSource = source
  currentLanguage = language
  sourceVersion += 1
}

const diagnosticData = (diagnostic: ts.Diagnostic, sourceFile: ts.SourceFile): TypeScriptDiagnostic => {
  const start = diagnostic.start ?? 0
  const location = sourceFile.getLineAndCharacterOfPosition(Math.min(start, sourceFile.text.length))
  return {
    category: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    start,
    length: Math.max(diagnostic.length ?? 1, 1),
    line: location.line + 1,
    column: location.character,
  }
}

const diagnostics = (source: string, language: SourceLanguage): readonly TypeScriptDiagnostic[] => {
  setSource(source, language)
  const fileName = activeFileName()
  const sourceFile = languageService.getProgram()?.getSourceFile(fileName)
  if (sourceFile === undefined) {
    return []
  }
  return languageService.getSyntacticDiagnostics(fileName).map((diagnostic) => diagnosticData(diagnostic, sourceFile))
}

const completionType = (kind: ts.ScriptElementKind): TypeScriptCompletion['type'] => {
  switch (kind) {
    case ts.ScriptElementKind.classElement:
      return 'class'
    case ts.ScriptElementKind.interfaceElement:
    case ts.ScriptElementKind.typeElement:
    case ts.ScriptElementKind.typeParameterElement:
      return 'type'
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.localFunctionElement:
    case ts.ScriptElementKind.memberFunctionElement:
      return 'function'
    case ts.ScriptElementKind.memberVariableElement:
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
      return 'property'
    case ts.ScriptElementKind.moduleElement:
      return 'namespace'
    case ts.ScriptElementKind.keyword:
      return 'keyword'
    case ts.ScriptElementKind.constElement:
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.parameterElement:
      return 'variable'
    default:
      return 'text'
  }
}

const completionStart = (source: string, position: number): number => {
  const word = source.slice(0, position).match(/[\p{L}\p{N}_$]+$/u)?.[0]
  return word === undefined ? position : position - word.length
}

const completions = (source: string, language: SourceLanguage, position: number): TypeScriptCompletions | null => {
  setSource(source, language)
  const info = languageService.getCompletionsAtPosition(activeFileName(), position, {
    includeCompletionsForImportStatements: true,
    includeCompletionsForModuleExports: false,
  })
  if (info === undefined) {
    return null
  }
  return {
    from: info.optionalReplacementSpan?.start ?? completionStart(source, position),
    options: info.entries.map((entry) => ({
      label: entry.name,
      type: completionType(entry.kind),
      detail: entry.kindModifiers || entry.kind,
      ...(entry.insertText === undefined ? {} : { apply: entry.insertText }),
    })),
  }
}

const quickInfo = (source: string, language: SourceLanguage, position: number): TypeScriptQuickInfo | null => {
  setSource(source, language)
  return serializeQuickInfo(
    languageService.getQuickInfoAtPosition(activeFileName(), Math.min(Math.max(position, 0), source.length)),
  )
}

const transpile = (source: string): { code: string; diagnostics: readonly TypeScriptDiagnostic[] } => {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      ...compilerOptions('ts'),
      allowJs: false,
      inlineSourceMap: false,
      sourceMap: false,
    },
    fileName: '/playground.ts',
    reportDiagnostics: true,
  })
  let fallbackSourceFile: ts.SourceFile | undefined
  return {
    code: result.outputText,
    diagnostics: (result.diagnostics ?? []).map((diagnostic) => {
      const sourceFile =
        diagnostic.file ??
        (fallbackSourceFile ??= ts.createSourceFile(
          '/playground.ts',
          source,
          ts.ScriptTarget.ES2023,
          true,
          ts.ScriptKind.TS,
        ))
      return diagnosticData(diagnostic, sourceFile)
    }),
  }
}

interface TypeScriptWorkerScope {
  postMessage(message: TypeScriptWorkerResponse): void
  addEventListener(type: 'message', listener: (event: MessageEvent<TypeScriptWorkerRequest>) => void): void
}

const scope = self as unknown as TypeScriptWorkerScope
const postToPage = scope.postMessage.bind(scope)

scope.addEventListener('message', (event: MessageEvent<TypeScriptWorkerRequest>): void => {
  const request = event.data
  try {
    const result = (() => {
      switch (request.type) {
        case 'completions':
          return completions(request.source, request.language, request.position)
        case 'diagnostics':
          return diagnostics(request.source, request.language)
        case 'quick-info':
          return quickInfo(request.source, request.language, request.position)
        case 'transpile':
          return transpile(request.source)
      }
    })()
    postToPage({ type: 'result', requestId: request.requestId, result })
  } catch (error) {
    postToPage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
