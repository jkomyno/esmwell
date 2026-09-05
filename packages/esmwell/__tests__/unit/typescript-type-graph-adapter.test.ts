import * as ts from 'typescript-legacy'
import {
  createTypeScriptTypeGraphAdapter,
  ESMWELL_TYPES_ROOT,
  type TypeScriptTypeGraph,
} from 'esmwell/typescript-editor'

it('resolves declaration formats and package-specific dependency versions', () => {
  const files = new Map<string, string>()
  const adapter = createTypeScriptTypeGraphAdapter({ compiler: ts, files })
  const scoped = `${ESMWELL_TYPES_ROOT}@scope/pkg@1.0.0/`
  const unscoped = `${ESMWELL_TYPES_ROOT}pkg@2.0.0/`
  const resolutions = [
    { specifier: 'dep', fileName: '/root.d.ts' },
    { specifier: 'dep', fileName: '/scoped.d.mts', containingFilePrefix: scoped },
    { specifier: 'dep', fileName: '/unscoped.d.cts', containingFilePrefix: unscoped },
  ]
  adapter.apply({ files: [], resolutions, complete: true })
  expect(adapter.resolveModule('dep', '/main.ts')).toEqual({
    resolvedFileName: '/root.d.ts',
    extension: ts.Extension.Dts,
    isExternalLibraryImport: true,
  })
  expect(adapter.resolveModule('dep', `${scoped}nested/index.d.ts`)).toEqual({
    resolvedFileName: '/scoped.d.mts',
    extension: ts.Extension.Dmts,
    isExternalLibraryImport: true,
  })
  expect(adapter.resolveModule('dep', `${unscoped}index.d.ts`)).toEqual({
    resolvedFileName: '/unscoped.d.cts',
    extension: ts.Extension.Dcts,
    isExternalLibraryImport: true,
  })
  expect(adapter.resolveModule('./local', '/main.ts')).toBeUndefined()
  expect(adapter.resolveModule('dep', `${ESMWELL_TYPES_ROOT}other@1/index.d.ts`)).toBeUndefined()
})

it('replaces only acquired files and skips applying the same graph twice', () => {
  const files = new Map([
    ['/main.ts', 'export {}'],
    ['/lib.d.ts', 'interface Array<T> {}'],
  ])
  const adapter = createTypeScriptTypeGraphAdapter({ compiler: ts, files })
  const first: TypeScriptTypeGraph = {
    files: [{ fileName: '/old.d.ts', content: 'export {}' }],
    resolutions: [{ specifier: 'old', fileName: '/old.d.ts' }],
    complete: true,
  }
  expect(adapter.apply(first)).toBe(true)
  expect(adapter.apply(first)).toBe(false)
  expect(
    adapter.apply({ files: [{ fileName: '/new.d.ts', content: 'export {}' }], resolutions: [], complete: false }),
  ).toBe(true)
  expect([...files.keys()]).toEqual(['/main.ts', '/lib.d.ts', '/new.d.ts'])
  expect(adapter.resolveModule('old', '/main.ts')).toBeUndefined()
})

it('updates real language-service completions and diagnostics when the type graph changes', () => {
  const source = "import { value } from 'pkg@1'\nimport { local } from './local'\nvalue."
  const files = new Map([
    ['/main.ts', source],
    ['/local.ts', 'export const local = 1'],
  ])
  const adapter = createTypeScriptTypeGraphAdapter({ compiler: ts, files })
  let version = 0
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      noLib: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    }),
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.d.ts',
    getScriptFileNames: () => ['/main.ts'],
    getProjectVersion: () => String(version),
    getScriptVersion: () => String(version),
    getScriptSnapshot: (fileName) => {
      const content = files.get(fileName)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    },
    readFile: (fileName) => files.get(fileName),
    fileExists: (fileName) => files.has(fileName),
    resolveModuleNameLiterals: (literals, containingFile, _redirect, options) =>
      literals.map(({ text }) => {
        const resolvedModule = adapter.resolveModule(text, containingFile)
        return resolvedModule === undefined
          ? ts.resolveModuleName(text, containingFile, options, host)
          : { resolvedModule }
      }),
  }
  const service = ts.createLanguageService(host)
  const root = `${ESMWELL_TYPES_ROOT}pkg@1.0.0/`
  const apply = (property: string): void => {
    const graph: TypeScriptTypeGraph = {
      files: [
        { fileName: `${root}index.d.ts`, content: "export { value } from './value'" },
        { fileName: `${root}value.d.ts`, content: `export declare const value: { ${property}: string }` },
      ],
      resolutions: [{ specifier: 'pkg@1', fileName: `${root}index.d.ts` }],
      complete: true,
    }
    if (adapter.apply(graph)) version += 1
  }
  const completions = (): string[] =>
    service.getCompletionsAtPosition('/main.ts', source.length, {})?.entries.map(({ name }) => name) ?? []
  try {
    apply('first')
    expect(completions()).toEqual(['first'])
    expect(service.getSemanticDiagnostics('/main.ts')).toEqual([])
    apply('second')
    expect(completions()).toEqual(['second'])
    if (adapter.apply({ files: [], resolutions: [], complete: true })) version += 1
    expect(completions()).toEqual([])
    expect(service.getSemanticDiagnostics('/main.ts').map(({ code }) => code)).toEqual([2307])
  } finally {
    service.dispose()
  }
})
