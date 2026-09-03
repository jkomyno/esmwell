// Page-realm test: autoInstall off rejects undeclared bare imports with an
// actionable error, and on resolves them from the CDN without a manifest.
import { createEsmwell } from '/esmwell/index.mjs'

test('autoInstall off errors on undeclared packages', async () => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 30_000,
  })
  try {
    const result = await session.runJudge(`import isEven from 'is-even'\nexport const solve = () => isEven(1)`, [
      { name: 'solve', exportName: 'solve', expected: true },
    ])

    assert(result.status === 'error', 'undeclared import fails the run')
    assert(
      result.error?.message.includes("could not resolve 'is-even'") === true,
      `error should name the package: ${result.error?.message}`,
    )
    assert(result.error?.message.includes('add it to deps') === true, 'error should point at the fix')
  } finally {
    session.close()
  }
})

test('autoInstall on resolves undeclared packages to the CDN latest', async () => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    timeoutMs: 30_000,
  })
  try {
    const result = await session.runJudge(`import isEven from 'is-even'\nexport const solve = () => isEven(4)`, [
      { name: 'solve', exportName: 'solve', expected: true },
    ])

    assert(result.ok === true, `undeclared import should auto-install: ${result.error?.message}`)
    assert(
      result.dependencies.some((dependency) => dependency.name === 'is-even' && dependency.version === 'latest'),
      'the auto-installed dependency is surfaced with its resolved version',
    )
  } finally {
    session.close()
  }
})
