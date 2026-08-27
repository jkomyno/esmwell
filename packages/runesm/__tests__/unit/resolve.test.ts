import { resolveDependencies, resolveImportSpecifier, SpecifierResolutionError } from 'src/resolve'

const resolve = (specifier: string, options?: { deps?: Record<string, string>; autoInstall?: boolean }) =>
  resolveImportSpecifier(specifier, options ?? {})

describe('resolveImportSpecifier: bare specifiers', () => {
  it('resolves unpinned packages to latest by default (autoInstall on)', () => {
    expect(resolve('lodash-es')).toEqual({
      url: 'https://esm.sh/lodash-es@latest',
      dependency: {
        specifier: 'lodash-es',
        name: 'lodash-es',
        version: 'latest',
        url: 'https://esm.sh/lodash-es@latest',
      },
    })
  })

  it('resolves pinned packages to the deps version', () => {
    const resolved = resolve('lodash-es', { deps: { 'lodash-es': '4.17.21' } })
    expect(resolved.url).toBe('https://esm.sh/lodash-es@4.17.21')
    expect(resolved.dependency?.version).toBe('4.17.21')
  })

  it('resolves scoped packages and subpaths against the package name', () => {
    const scoped = resolve('@scope/pkg')
    expect(scoped.url).toBe('https://esm.sh/@scope/pkg@latest')

    const subpath = resolve('lodash-es/clone', { deps: { 'lodash-es': '4.17.21' } })
    expect(subpath.url).toBe('https://esm.sh/lodash-es@4.17.21/clone')
    expect(subpath.dependency).toEqual({
      specifier: 'lodash-es/clone',
      name: 'lodash-es',
      version: '4.17.21',
      url: 'https://esm.sh/lodash-es@4.17.21/clone',
    })

    const scopedSubpath = resolve('@scope/pkg/entry/point')
    expect(scopedSubpath.url).toBe('https://esm.sh/@scope/pkg@latest/entry/point')
  })

  it('resolves pinned packages when autoInstall is off', () => {
    const resolved = resolve('pinned', { deps: { pinned: '2.0.0' }, autoInstall: false })
    expect(resolved.url).toBe('https://esm.sh/pinned@2.0.0')
  })

  it('errors on unpinned packages when autoInstall is off', () => {
    expect(() => resolve('unpinned', { autoInstall: false })).toThrow(SpecifierResolutionError)
    expect(() => resolve('unpinned', { autoInstall: false })).toThrow(
      "could not resolve 'unpinned' — check the package name or add it to deps",
    )
  })
})

describe('resolveImportSpecifier: passthrough and rejection', () => {
  it('passes absolute urls through without dependency metadata', () => {
    for (const url of [
      'https://esm.sh/lodash-es@4.17.21',
      'http://cdn.example.com/mod.mjs',
      'data:text/javascript,export default 1',
      'blob:https://example.com/uuid',
    ]) {
      expect(resolve(url)).toEqual({ url })
    }
  })

  it.each(['./sibling.ts', '../parent.ts', '.', '..', '/absolute.ts', '#internal'])(
    'rejects %j as unsupported',
    (specifier) => {
      expect(() => resolve(specifier)).toThrow(SpecifierResolutionError)
      expect(() => resolve(specifier)).toThrow(/relative and import-map imports are not supported/)
    },
  )
})

describe('resolveImportSpecifier: node modules', () => {
  it.each(['node:events', 'node:crypto', 'node:zlib'])('marks %j as a planned shim', (specifier) => {
    const error = capture(() => resolve(specifier))
    expect(error).toBeInstanceOf(SpecifierResolutionError)
    expect((error as SpecifierResolutionError).kind).toBe('node-module')
    expect((error as SpecifierResolutionError).message).toContain(
      'no browser shim is available yet, but one is planned',
    )
  })

  it('suggests the native alternative for planned shims', () => {
    expect(messageOf(() => resolve('node:events'))).toMatch(/EventTarget/)
    expect(messageOf(() => resolve('node:crypto'))).toMatch(/globalThis\.crypto/)
    expect(messageOf(() => resolve('node:querystring'))).toMatch(/URLSearchParams/)
  })

  it('points module-specific tier modules at their browser alternative', () => {
    expect(messageOf(() => resolve('node:fs'))).toMatch(/IndexedDB/)
    expect(messageOf(() => resolve('node:module'))).toMatch(/ESM imports only/)
    expect(messageOf(() => resolve('node:http'))).toMatch(/fetch\(\)/)
  })

  it.each(['node:child_process', 'node:net', 'node:vm', 'node:tls', 'node:cluster'])(
    'marks %j as having no browser equivalent',
    (specifier) => {
      expect(messageOf(() => resolve(specifier))).toMatch(/has no browser equivalent/)
    },
  )
})

describe('resolveDependencies', () => {
  it('surfaces the resolved dependency list', () => {
    const dependencies = resolveDependencies(['lodash-es/clone', 'lodash-es', 'react'], {
      deps: { 'lodash-es': '4.17.21' },
    })
    expect(dependencies).toEqual([
      {
        specifier: 'lodash-es/clone',
        name: 'lodash-es',
        version: '4.17.21',
        url: 'https://esm.sh/lodash-es@4.17.21/clone',
      },
      {
        specifier: 'lodash-es',
        name: 'lodash-es',
        version: '4.17.21',
        url: 'https://esm.sh/lodash-es@4.17.21',
      },
      {
        specifier: 'react',
        name: 'react',
        version: 'latest',
        url: 'https://esm.sh/react@latest',
      },
    ])
  })

  it('skips url specifiers and throws on the first failure', () => {
    expect(resolveDependencies(['https://cdn.example.com/a.mjs'], {})).toEqual([])
    expect(() => resolveDependencies(['fine-pkg', 'node:fs'], {})).toThrow(SpecifierResolutionError)
  })
})

const capture = (run: () => unknown): unknown => {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

const messageOf = (run: () => unknown): string => {
  const error = capture(run)
  expect(error).toBeInstanceOf(SpecifierResolutionError)
  return (error as Error).message
}
