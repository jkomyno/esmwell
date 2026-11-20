import { createReplSessionInRealm } from 'src/bootstrap'
import { createDataModuleUrl, importModule } from 'src/loader'

const programs = [
  {
    name: 'hoisting and a closure over a reassigned binding',
    inputs: (value: number) => [
      `let current = ${value}\nconst before = read()\nfunction read() { return current }`,
      'current += 3',
    ],
    expression: '[before, read()]',
  },
  {
    name: 'computed destructuring and shadowing',
    inputs: (value: number) => [
      `const key = 'value'\nlet observed = ${value}`,
      '({ [key]: observed } = { value: observed + 2 })',
    ],
    expression: '[observed, ((observed) => observed + 1)(10)]',
  },
  {
    name: 'nested updates through a persisted closure',
    inputs: (value: number) => [
      `let count = ${value}\nconst add = () => (${value % 2 === 0 ? '++count' : 'count += 2'})`,
      'const snapshot = [add(), add()]',
    ],
    expression: '[snapshot, count]',
  },
  {
    name: 'a reference error after reading a persisted binding',
    inputs: (value: number) => [`const observed = ${value}`],
    expression: 'observed + missingBinding',
  },
]

const generateValues = (seed: number): number[] => {
  let state = seed
  return Array.from({ length: 8 }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return (state % 41) - 20
  })
}

it.each(programs)('matches native ESM for $name', async ({ inputs, expression }) => {
  for (const value of generateValues(0x45534d)) {
    const submissions = inputs(value)
    const source = [...submissions, `export default (${expression})`].join(';\n')
    const expected = await importModule(createDataModuleUrl(source)).then(
      (module) => ({ ok: true, value: module.default }),
      (error: unknown) => {
        if (!(error instanceof Error)) throw error
        return { ok: false, error: { name: error.name } }
      },
    )

    const session = createReplSessionInRealm({})
    for (const submission of submissions) {
      expect(await session.evaluate(submission)).toMatchObject({ ok: true })
    }
    expect(await session.evaluate(expression)).toMatchObject(expected)
  }
})
