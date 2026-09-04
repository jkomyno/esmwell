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

  it.each(['constructor', 'toString', 'valueOf', '__proto__'])(
    'treats %j as undeclared under autoInstall: false, not as pinned via Object.prototype',
    (specifier) => {
      const error = capture(() => resolve(specifier, { deps: {}, autoInstall: false }))
      expect(error).toBeInstanceOf(SpecifierResolutionError)
      expect((error as SpecifierResolutionError).kind).toBe('undeclared')
    },
  )

  it('asserts the resolved URL path still starts with the reported name@version', () => {
    for (const resolved of [
      resolve('lodash-es', { deps: { 'lodash-es': '4.17.21' } }),
      resolve('@scope/pkg/entry/point'),
      resolve('lodash-es/clone', { deps: { 'lodash-es': '4.17.21' } }),
    ]) {
      const dependency = resolved.dependency
      if (dependency === undefined) {
        throw new Error('expected a resolved dependency')
      }
      const pathname = new URL(dependency.url).pathname
      expect(pathname.startsWith(`/${dependency.name}@${dependency.version}`)).toBe(true)
    }
  })
})

describe('resolveImportSpecifier: subpath and specifier validation', () => {
  it.each(['a/..', 'a/../evil', 'a/../../evil', 'a/./sub', 'a//sub'])(
    'rejects %j: subpath must not contain "..", ".", or empty segments',
    (specifier) => {
      expect(() => resolve(specifier)).toThrow(SpecifierResolutionError)
      expect(() => resolve(specifier)).toThrow(/subpath must not contain/)
    },
  )

  it.each(['pkg?x=1', 'pkg#frag', 'pkg/sub?x=1', 'pkg with space'])(
    'rejects %j: specifiers cannot contain "?", "#", or whitespace',
    (specifier) => {
      expect(() => resolve(specifier)).toThrow(SpecifierResolutionError)
      expect(() => resolve(specifier)).toThrow(/cannot contain/)
    },
  )

  it('resolves an inline version with a subpath when autoInstall is off', () => {
    expect(resolve('effect@beta/Option', { autoInstall: false })).toEqual({
      url: 'https://esm.sh/effect@beta/Option',
      dependency: {
        specifier: 'effect@beta/Option',
        name: 'effect',
        version: 'beta',
        url: 'https://esm.sh/effect@beta/Option',
      },
    })
  })

  it('resolves an inline version on a scoped package', () => {
    expect(resolve('@scope/pkg@1.2.3/subpath', { autoInstall: false })).toEqual({
      url: 'https://esm.sh/@scope/pkg@1.2.3/subpath',
      dependency: {
        specifier: '@scope/pkg@1.2.3/subpath',
        name: '@scope/pkg',
        version: '1.2.3',
        url: 'https://esm.sh/@scope/pkg@1.2.3/subpath',
      },
    })
  })

  it('lets an inline version override deps', () => {
    const resolved = resolve('effect@beta/Schema', { deps: { effect: '3.22.1' } })
    expect(resolved.dependency?.version).toBe('beta')
    expect(resolved.url).toBe('https://esm.sh/effect@beta/Schema')
  })

  it.each(['effect@', 'effect@@beta', '@scope/pkg@'])('rejects invalid inline version %j', (specifier) => {
    const error = capture(() => resolve(specifier))
    expect(error).toBeInstanceOf(SpecifierResolutionError)
    expect((error as SpecifierResolutionError).kind).toBe('unsupported')
    expect((error as Error).message).toMatch(/inline package version/)
  })

  it('still resolves legitimate scoped packages and deep subpaths', () => {
    expect(resolve('@scope/pkg/sub').url).toBe('https://esm.sh/@scope/pkg@latest/sub')
    expect(resolve('lodash-es/deep/nested/path').url).toBe('https://esm.sh/lodash-es@latest/deep/nested/path')
  })

  it('passes absolute urls through without validating them as specifiers', () => {
    expect(resolve('https://esm.sh/pkg@1?x=1')).toEqual({ url: 'https://esm.sh/pkg@1?x=1' })
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
  it.each(['process', 'node:process'])('resolves %j to the built-in browser facade', (specifier) => {
    const resolved = resolve(specifier, { autoInstall: false })
    expect(resolved.dependency).toBeUndefined()
    expect(resolved.url).toMatch(/^data:text\/javascript;charset=utf-8,/)
    expect(decodeURIComponent(resolved.url)).toContain('export default process')
  })

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
