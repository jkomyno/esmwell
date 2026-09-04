import { createReplSession, createEsmwell } from '/esmwell/index.mjs'

const runProcessProbe = async (code: string, expected: unknown) => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 10_000,
  })
  try {
    return await session.runJudge(code, [{ name: 'node:process contract', exportName: 'solve', expected }])
  } finally {
    session.close()
  }
}

test('exposes the documented node:process module and facade surfaces', async () => {
  const result = await runProcessProbe(
    `
      import bareProcess from 'process'
      import processDefault, * as processModule from 'node:process'

      const missingNames = [
        'abort', 'arch', 'execArgv', 'execPath', 'exit', 'getBuiltinModule',
        'hrtime', 'kill', 'loadEnvFile', 'memoryUsage', 'pid', 'platform',
        'ppid', 'report', 'stderr', 'stdin', 'stdout', 'uptime',
      ]

      export const solve = () => ({
        sameIdentity:
          bareProcess === processDefault &&
          processModule.default === processDefault &&
          processModule.process === processDefault &&
          processDefault === globalThis.process,
        moduleKeys: Object.keys(processModule).sort(),
        facadeKeys: Object.keys(processDefault).sort(),
        frozen: Object.isFrozen(processDefault),
        namedReferences: {
          argv: processModule.argv === processDefault.argv,
          chdir: processModule.chdir === processDefault.chdir,
          cwd: processModule.cwd === processDefault.cwd,
          env: processModule.env === processDefault.env,
          nextTick: processModule.nextTick === processDefault.nextTick,
          versions: processModule.versions === processDefault.versions,
        },
        metadata: {
          browser: processModule.browser,
          title: processModule.title,
          version: processModule.version,
          versionKeys: Object.keys(processModule.versions),
          platform: processModule.platform,
        },
        missing: Object.fromEntries(missingNames.map((name) => [name, typeof processDefault[name]])),
      })
    `,
    {
      sameIdentity: true,
      moduleKeys: [
        'argv',
        'browser',
        'chdir',
        'cwd',
        'default',
        'env',
        'nextTick',
        'platform',
        'process',
        'title',
        'version',
        'versions',
      ],
      facadeKeys: [
        'addListener',
        'argv',
        'browser',
        'chdir',
        'cwd',
        'emit',
        'env',
        'nextTick',
        'off',
        'on',
        'once',
        'removeListener',
        'title',
        'version',
        'versions',
      ],
      frozen: true,
      namedReferences: { argv: true, chdir: true, cwd: true, env: true, nextTick: true, versions: true },
      metadata: { browser: true, title: 'browser', version: '', versionKeys: [], platform: undefined },
      missing: {
        abort: 'undefined',
        arch: 'undefined',
        execArgv: 'undefined',
        execPath: 'undefined',
        exit: 'undefined',
        getBuiltinModule: 'undefined',
        hrtime: 'undefined',
        kill: 'undefined',
        loadEnvFile: 'undefined',
        memoryUsage: 'undefined',
        pid: 'undefined',
        platform: 'undefined',
        ppid: 'undefined',
        report: 'undefined',
        stderr: 'undefined',
        stdin: 'undefined',
        stdout: 'undefined',
        uptime: 'undefined',
      },
    },
  )

  assert(result.ok === true, `node:process surface should match its contract: ${JSON.stringify(result)}`)
})

test('implements the documented partial node:process semantics', async () => {
  const result = await runProcessProbe(
    `
      import process from 'node:process'

      export const solve = async () => {
        let listenerCalls = 0
        const listener = () => { listenerCalls += 1 }
        const listenerMethodsReturnProcess = [
          process.on('esmwell', listener),
          process.once('esmwell', listener),
          process.off('esmwell', listener),
          process.addListener('esmwell', listener),
          process.removeListener('esmwell', listener),
        ].every((value) => value === process)
        const emitted = process.emit('esmwell', 1)

        process.env.ESMWELL_MODE = 'browser'
        process.env.ESMWELL_NUMBER = 42
        process.argv.push('input.js', '--inspect')

        const titleChanged = Reflect.set(process, 'title', 'node')
        let chdirMessage = ''
        try {
          process.chdir('/tmp')
        } catch (error) {
          chdirMessage = error instanceof Error ? error.message : String(error)
        }

        const events = ['sync']
        const nextTickValue = new Promise((resolve) => {
          process.nextTick((left, right) => {
            events.push('nextTick')
            resolve(left + right)
          }, 20, 22)
        })
        queueMicrotask(() => events.push('queueMicrotask'))
        const sum = await nextTickValue

        return {
          argv: process.argv,
          chdirMessage,
          cwd: process.cwd(),
          emitted,
          env: process.env,
          events,
          listenerCalls,
          listenerMethodsReturnProcess,
          sum,
          title: process.title,
          titleChanged,
        }
      }
    `,
    {
      argv: ['input.js', '--inspect'],
      chdirMessage: "process.chdir('/tmp') is not supported in a browser worker",
      cwd: '/',
      emitted: false,
      env: { ESMWELL_MODE: 'browser', ESMWELL_NUMBER: 42 },
      events: ['sync', 'nextTick', 'queueMicrotask'],
      listenerCalls: 0,
      listenerMethodsReturnProcess: true,
      sum: 42,
      title: 'browser',
      titleChanged: false,
    },
  )

  assert(result.ok === true, `node:process semantics should match their contract: ${JSON.stringify(result)}`)
})

test('starts every judge run with fresh process env and argv contents', async () => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 10_000,
  })
  try {
    const mutated = await session.runJudge(
      `export const solve = () => {
        process.env.ESMWELL_MODE = 'first'
        process.argv.push('first.js')
        return { env: process.env.ESMWELL_MODE, argv: process.argv }
      }`,
      [{ name: 'mutates process contents', exportName: 'solve', expected: { env: 'first', argv: ['first.js'] } }],
    )
    assert(mutated.ok === true, `first judge realm should mutate process contents: ${JSON.stringify(mutated)}`)

    const fresh = await session.runJudge(
      `export const solve = () => ({ envKeys: Object.keys(process.env), argv: process.argv })`,
      [{ name: 'gets fresh process contents', exportName: 'solve', expected: { envKeys: [], argv: [] } }],
    )
    assert(fresh.ok === true, `next judge realm should get fresh process contents: ${JSON.stringify(fresh)}`)
  } finally {
    session.close()
  }
})

test('persists REPL process contents until reset replaces the child realm', async () => {
  const session = createReplSession({
    workerUrl: '/esmwell/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 10_000,
  })
  try {
    const mutated = await session.evaluate(
      `process.env.ESMWELL_MODE = 'repl'
       process.argv.push('repl.js')`,
    )
    assert(mutated.ok === true, `REPL should mutate process contents: ${mutated.error?.message}`)

    const persistent = await session.evaluate(`({ env: process.env.ESMWELL_MODE, argv: process.argv })`)
    assertEqual(persistent.value, { env: 'repl', argv: ['repl.js'] }, 'REPL process contents persist')

    await session.reset()
    const reset = await session.evaluate(`({ envKeys: Object.keys(process.env), argv: process.argv })`)
    assertEqual(reset.value, { envKeys: [], argv: [] }, 'reset starts a fresh process facade')
  } finally {
    session.close()
  }
})
