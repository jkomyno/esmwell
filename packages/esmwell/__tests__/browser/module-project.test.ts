import { createModuleProjectSession } from '/esmwell/index.mjs'

const projectOptions = {
  workerUrl: '/esmwell/project-worker-entry.mjs',
  serviceWorkerUrl: '/esmwell/module-service-worker.mjs',
  timeoutMs: 10_000,
} as const

test('runs a module project with relative imports, cycles, live bindings, and dependency precedence', async () => {
  const session = createModuleProjectSession({
    ...projectOptions,
    deps: { 'is-even': '0.1.0', 'local-value': '9.9.9' },
    autoInstall: false,
  })
  try {
    const result = await session.run({
      modules: {
        'local-value': `export const localValue = 'local'`,
        'src/cycle-a': `
          import { readB } from './cycle-b'
          export let value = 'initial'
          export const update = (next) => { value = next }
          export const read = () => readB()
        `,
        'src/cycle-b': `
          import { value } from './cycle-a'
          export const readB = () => value
        `,
        'src/main': `
          import { read, update } from './cycle-a'
          import { localValue } from 'local-value'
          import isEven from 'is-even@1.0.0'

          const before = read()
          update('updated')
          export const outcome = { before, after: read(), localValue, even: isEven(4) }
          export function callable() { return outcome }
        `,
      },
      entry: 'src/main',
    })

    assert(result.status === 'pass', `project should pass: ${JSON.stringify(result)}`)
    assertEqual(
      result.exports.outcome,
      { before: 'initial', after: 'updated', localValue: 'local', even: true },
      'project entry exports',
    )
    assert(result.exports.callable === '[function callable]', 'non-cloneable entry exports should use previews')
    assertEqual(
      result.dependencies.map((dependency) => [dependency.name, dependency.version]),
      [['is-even', '1.0.0']],
      'inline dependency versions should override deps and local ids should override packages',
    )
  } finally {
    session.close()
  }
})

test('reports missing project entries and local modules with actionable errors', async () => {
  const session = createModuleProjectSession({ ...projectOptions, autoInstall: false })
  try {
    const missingEntry = await session.run({
      modules: { 'src/main': `export const value = 1` },
      entry: 'src/missing',
    })
    assert(missingEntry.status === 'error', 'a missing entry should be an error result')
    assert(
      missingEntry.error?.message.includes("could not find entry module 'src/missing'") === true,
      `missing-entry error should name the canonical id: ${missingEntry.error?.message}`,
    )

    const missingLocal = await session.run({
      modules: { 'src/main': `import { value } from './missing'\nexport { value }` },
      entry: 'src/main',
    })
    assert(missingLocal.status === 'error', 'a missing local module should be an error result')
    assert(
      missingLocal.error?.message.includes("could not find local module 'src/missing' imported from 'src/main'") ===
        true,
      `missing-local error should name the module and importer: ${missingLocal.error?.message}`,
    )
  } finally {
    session.close()
  }
})

test('keeps runtime-owned process imports ahead of local module ids', async () => {
  const session = createModuleProjectSession({ ...projectOptions, autoInstall: false })
  try {
    const result = await session.run({
      modules: {
        process: `export default { browser: false }`,
        'src/main': `
          import process from 'process'
          export const same = process === globalThis.process
          export const browser = process.browser
        `,
      },
      entry: 'src/main',
    })

    assert(result.status === 'pass', `project should pass: ${JSON.stringify(result)}`)
    assert(result.exports.same === true, 'process import should use the runtime-owned global facade')
    assert(result.exports.browser === true, 'process import should retain the browser marker')
  } finally {
    session.close()
  }
})

test('terminates a synchronous project loop and removes its virtual graph', async () => {
  const session = createModuleProjectSession({ ...projectOptions, timeoutMs: 500 })
  try {
    const result = await session.run({
      modules: { 'src/main': `while (true) {}` },
      entry: 'src/main',
    })

    assert(result.error?.name === 'TimeoutError', `hung project should time out: ${JSON.stringify(result)}`)
    const cacheNames = await caches.keys()
    assert(
      cacheNames.every((name) => !name.startsWith('esmwell:test-graph:')),
      `module graph caches should be removed after timeout: ${cacheNames.join(', ')}`,
    )
  } finally {
    session.close()
  }
})

test('import.meta.main is true in the entry and false in every imported module', async () => {
  const session = createModuleProjectSession({ ...projectOptions, autoInstall: false })
  try {
    const result = await session.run({
      modules: {
        'src/sibling': `
          export const siblingMain = import.meta.main
          export const siblingHasMain = 'main' in import.meta
          export const siblingUrl = import.meta.url
        `,
        'src/main': `
          import { siblingHasMain, siblingMain, siblingUrl } from './sibling'
          export const main = import.meta.main
          export const negated = !import.meta.main
          export const keys = Object.keys(import.meta)
          export const urls = [import.meta.url, siblingUrl]
          export { siblingHasMain, siblingMain }
        `,
      },
      entry: 'src/main',
    })

    assert(result.status === 'pass', `project should pass: ${JSON.stringify(result)}`)
    assert(result.exports.main === true, 'the entry should see import.meta.main === true')
    assert(result.exports.negated === false, 'the entry should read as main under negation')
    assert(result.exports.siblingMain === false, 'an imported module should see import.meta.main === false')
    assert(result.exports.siblingHasMain === true, 'a non-entry module still owns the main property')
    assert((result.exports.keys as string[]).includes('main'), 'main should be an enumerable import.meta key')
    const [entryUrl, siblingUrl] = result.exports.urls as [string, string]
    assert(
      entryUrl.endsWith('/src/main.mjs') && siblingUrl.endsWith('/src/sibling.mjs'),
      'import.meta.url stays native',
    )
  } finally {
    session.close()
  }
})

test('import.meta.main follows the entry of each run over a shared module graph', async () => {
  const session = createModuleProjectSession({ ...projectOptions, autoInstall: false })
  const modules = {
    'src/shared': `export const sharedMain = import.meta.main`,
    'src/first': `
      import { sharedMain } from './shared'
      export const firstMain = import.meta.main
      export { sharedMain }
    `,
    'src/second': `
      import { sharedMain } from './shared'
      import { firstMain } from './first'
      export const secondMain = import.meta.main
      export { firstMain, sharedMain }
    `,
  }
  try {
    const first = await session.run({ modules, entry: 'src/first' })
    const second = await session.run({ modules, entry: 'src/second' })

    assert(
      first.status === 'pass' && second.status === 'pass',
      `both runs should pass: ${JSON.stringify([first, second])}`,
    )
    assertEqual(first.exports, { firstMain: true, sharedMain: false }, 'run with src/first as entry')
    assertEqual(
      second.exports,
      { firstMain: false, secondMain: true, sharedMain: false },
      'run with src/second as entry',
    )
  } finally {
    session.close()
  }
})

test('the .js alias of the entry agrees with its canonical id', async () => {
  const session = createModuleProjectSession({ ...projectOptions, autoInstall: false })
  const entrySource = `
    import * as alias from './main.js'
    import { utilMain, utilAliasMain } from './util'
    export const main = import.meta.main
    export const url = import.meta.url
    export const aliasMain = alias.main
    export const aliasIsSeparateInstance = alias.url !== url
    export { utilMain, utilAliasMain }
  `
  const utilSource = `
    import * as alias from './util.js'
    export const utilMain = import.meta.main
    export const utilAliasMain = alias.utilMain
  `
  try {
    const result = await session.run({
      modules: {
        'src/main': entrySource,
        'src/main.js': entrySource,
        'src/util': utilSource,
        'src/util.js': utilSource,
      },
      entry: 'src/main',
    })

    assert(result.status === 'pass', `project should pass: ${JSON.stringify(result)}`)
    assert(result.exports.aliasIsSeparateInstance === true, 'the alias is a separate module instance to the linker')
    assertEqual(
      [result.exports.main, result.exports.aliasMain, result.exports.utilMain, result.exports.utilAliasMain],
      [true, true, false, false],
      'canonical id and alias agree on main for the entry and for a sibling',
    )
  } finally {
    session.close()
  }
})

test('rewriting import.meta keeps stack-trace positions where the author wrote them', async () => {
  const session = createModuleProjectSession({ ...projectOptions, autoInstall: false })
  // The control module is the same program with no `import.meta` on line 1,
  // so nothing is rewritten in it. Browsers disagree on which column of a
  // `throw` they report, so the rewritten module is held to the control's
  // position rather than to a fixed number.
  const boomSource = (firstLine: string): string =>
    [firstLine, `export const boom = () => {`, `  throw new Error('thrown from line 3')`, `}`].join('\n')
  const thrownPosition = async (firstLine: string): Promise<[line: number, column: number]> => {
    const result = await session.run({
      modules: { 'src/main': `import { boom } from './boom'\nboom()`, 'src/boom': boomSource(firstLine) },
      entry: 'src/main',
    })
    assert(result.error?.message === 'thrown from line 3', `the throw should surface: ${JSON.stringify(result)}`)
    const position = /src\/boom\.mjs:(\d+):(\d+)/.exec(result.error.stack ?? '')
    assert(position !== null, `stack should locate the throw in src/boom: ${result.error.stack}`)
    return [Number(position[1]), Number(position[2])]
  }
  try {
    const control = await thrownPosition(`export const flag = false`)
    const rewritten = await thrownPosition(`export const flag = import.meta.main`)

    assertEqual(control[0], 3, 'the control run reports the authored line')
    assertEqual(rewritten, control, 'line and column of the throw after an import.meta rewrite')
  } finally {
    session.close()
  }
})

test('runs editor paths and extension aliases with native entry flags', async () => {
  const { canonicalModuleId, createProjectModules } = await import('/esmwell/utils.mjs')
  const session = createModuleProjectSession(projectOptions)
  try {
    const result = await session.run({
      modules: createProjectModules([
        ['/src/main.ts', `import { value } from './value.mjs'; export { value }; export const main = import.meta.main`],
        ['/src/value.mts', 'export const value = 42'],
      ]),
      entry: canonicalModuleId('/src/main.ts'),
    })
    assert(result.status === 'pass', `editor graph should run: ${JSON.stringify(result)}`)
    assertEqual(result.exports.value, 42, 'extension alias export')
    assertEqual(result.exports.main, true, 'editor entry flag')
  } finally {
    session.close()
  }
})
