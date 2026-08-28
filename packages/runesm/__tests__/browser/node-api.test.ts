import { createRunesm } from '/runesm/index.mjs'

test('reports why a Node-API package cannot run in the browser worker', async () => {
  const session = createRunesm({
    workerUrl: '/runesm/worker-entry.mjs',
    autoInstall: false,
    timeoutMs: 30_000,
  })
  try {
    const result = await session.runJudge(
      `import { createCanvas } from '@napi-rs/canvas@1.0.8'
       export const solve = () => createCanvas(1, 1).width`,
      [{ name: 'native canvas', exportName: 'solve', expected: 1 }],
    )

    assert(result.status === 'error', `Node-API package should fail in a browser worker: ${JSON.stringify(result)}`)
    assert(
      result.error?.name === 'DependencyLoadError',
      `error should identify a dependency load failure: ${result.error?.name}`,
    )
    assert(
      result.error?.message.includes("'@napi-rs/canvas@1.0.8' (https://esm.sh/@napi-rs/canvas@1.0.8)") === true,
      `error should identify the package and URL: ${result.error?.message}`,
    )
    assert(
      result.error?.message.includes('Node-API addons cannot run in a browser worker') === true,
      'error should explain the native boundary',
    )
    assert(
      result.error?.message.includes('browser/WebAssembly build') === true,
      'error should recommend a browser-compatible build',
    )
    assert(
      result.error?.message.includes('browser network panel') === true,
      'error should include a concrete debugging step',
    )
    assert(
      result.dependencies.some((dependency) => dependency.name === '@napi-rs/canvas' && dependency.version === '1.0.8'),
      'the failed dependency should remain visible in the result',
    )
  } finally {
    session.close()
  }
})
