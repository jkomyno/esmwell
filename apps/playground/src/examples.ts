import type { JudgeCase } from 'runesm'

export const DEFAULT_CODE = `import * as Console from 'effect@beta/Console'
import * as Effect from 'effect@beta/Effect'
import * as Schema from 'effect@beta/Schema'

// Bare imports resolve from esm.sh at runtime — no bundler, no install.
// The inline @beta tag wins over the deps list below.
const User = Schema.Struct({ name: Schema.String, age: Schema.Number })

export const solve = (input) => {
  const program = Effect.gen(function* () {
    const user = Schema.decodeUnknownSync(User)(input)
    yield* Console.log(\`decoded \${user.name} (age \${user.age})\`)
    return \`hello, \${user.name}\`
  })

  return new Promise((resolve) => {
    Effect.runFork(program).addObserver((exit) => resolve(exit.value))
  })
}
`

export const DEMO_CASES: readonly JudgeCase[] = [
  { name: 'greets a decoded user', exportName: 'solve', args: [{ name: 'runesm', age: 3 }], expected: 'hello, runesm' },
  { name: 'greets another user', exportName: 'solve', args: [{ name: 'effect', age: 4 }], expected: 'hello, effect' },
]
