// Page-realm test: real module worker, real CDN import, judged end to end.
// `test`, `assert`, and `assertEqual` are provided by the harness runner;
// esmwell is imported from the served build, never from source.
import { createEsmwell } from '/esmwell/index.mjs'

test('judge run imports a pinned package from esm.sh and reports cases', async () => {
  const session = createEsmwell({
    workerUrl: '/esmwell/worker-entry.mjs',
    deps: { 'is-even': '1.0.0' },
    timeoutMs: 30_000,
  })
  try {
    const chunks: string[] = []
    const result = await session.runJudge(
      `import isEven from 'is-even'\nconsole.log('checking')\nexport const solve = (n) => isEven(n)\nexport const broken = () => 2`,
      [
        { name: 'even number', exportName: 'solve', args: [10], expected: true },
        { name: 'odd number', exportName: 'solve', args: [3], expected: false },
        { name: 'mismatch is reported', exportName: 'broken', expected: 3 },
      ],
      {
        onConsoleChunk: (chunk) => {
          chunks.push(chunk.parts.join(' '))
        },
      },
    )

    assertEqual(
      result.cases.map((caseResult) => caseResult.status),
      ['pass', 'pass', 'fail'],
      'case statuses',
    )
    assert(result.ok === false, 'a failing case must mark the run as not ok')
    assert(chunks.join(',') === 'checking', 'console chunk should stream before the result')
    assert(result.console.length === 1, 'console output is captured in the result')
    assert(
      result.dependencies.some((dependency) => dependency.name === 'is-even' && dependency.version === '1.0.0'),
      'the pinned dependency is surfaced',
    )
  } finally {
    session.close()
  }
})
