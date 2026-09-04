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
