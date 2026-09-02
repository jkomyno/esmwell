// Page-realm test: Zod 4's runtime code generation. `z.compile()` and the
// `zod/compile` global mode build validators with `new Function` inside the
// package itself. That works in the child execution worker: runesm's
// Function-constructor policy is a parse-time gate on submitted source, not a
// restriction on dependency code, and the worker sets no `unsafe-eval` CSP.
// Guards the compatibility claim for compiled Zod schemas.
import { createRunesm } from '/runesm/index.mjs'

interface JudgeCase {
  name: string
  exportName: string
  args?: unknown[]
  expected?: unknown
}

const runZod = async (code: string, cases: JudgeCase[]) => {
  const session = createRunesm({
    workerUrl: '/runesm/worker-entry.mjs',
    deps: { zod: '4' },
    autoInstall: false,
    timeoutMs: 30_000,
  })
  try {
    return await session.runJudge(code, cases)
  } finally {
    session.close()
  }
}

test('runs zod 4 schemas compiled at runtime with z.compile', async () => {
  const result = await runZod(
    `
      import * as z from 'zod'

      // strict: true turns a silent fallback to the interpreted path into an
      // error, so a pass here means the generated validator actually ran.
      const Player = z.compile(z.object({ username: z.string(), xp: z.number() }), { strict: true })

      export const solve = (input) => Player.parse(input)
      export const rejects = (input) => {
        const parsed = Player.safeParse(input)
        return { success: parsed.success, code: parsed.error?.issues[0]?.code }
      }
    `,
    [
      {
        name: 'compiled schema parses valid input',
        exportName: 'solve',
        args: [{ username: 'runesm', xp: 42 }],
        expected: { username: 'runesm', xp: 42 },
      },
      {
        name: 'compiled schema reports the same issue codes',
        exportName: 'rejects',
        args: [{ username: 'runesm', xp: 'many' }],
        expected: { success: false, code: 'invalid_type' },
      },
    ],
  )

  assert(result.ok === true, `z.compile should run: ${result.cases[0]?.error?.message ?? result.error?.message}`)
  assert(
    result.dependencies.some((dependency) => dependency.name === 'zod' && dependency.version === '4'),
    `the pinned zod version is surfaced: ${JSON.stringify(result.dependencies)}`,
  )
})

test('runs the zod/compile global mode as a side-effect import', async () => {
  const result = await runZod(
    `
      import 'zod/compile'
      import * as z from 'zod'

      const Player = z.object({ username: z.string(), xp: z.number() })

      export const solve = (input) => Player.parse(input)
    `,
    [
      {
        name: 'globally compiled schema parses valid input',
        exportName: 'solve',
        args: [{ username: 'runesm', xp: 42 }],
        expected: { username: 'runesm', xp: 42 },
      },
    ],
  )

  assert(result.ok === true, `zod/compile should run: ${result.cases[0]?.error?.message ?? result.error?.message}`)
  assert(
    result.dependencies.some(
      (dependency) => dependency.specifier === 'zod/compile' && dependency.url === 'https://esm.sh/zod@4/compile',
    ),
    `the zod/compile subpath resolves through esm.sh: ${JSON.stringify(result.dependencies)}`,
  )
})

// The contrast that makes the two tests above meaningful: a dependency may
// generate code at runtime, while the same construct in submitted source is
// rejected before the module is ever evaluated.
test('still rejects a Function constructor written in submitted code', async () => {
  const result = await runZod(`export const solve = () => new Function('return 1')()`, [
    { name: 'never runs', exportName: 'solve', expected: 1 },
  ])

  assert(result.ok === false, 'submitted new Function must not execute')
  assert(
    result.error?.message.includes('Function constructor is not allowed in submitted code') === true,
    `the policy violation is reported: ${result.error?.message}`,
  )
})
