import type { JudgeCase } from 'runesm'

export const DEFAULT_CODE = /* typescript */ `import * as Console from 'effect@beta/Console'
import * as Effect from 'effect@beta/Effect'
import * as Schema from 'effect@beta/Schema'
import { uuidv7 } from 'uniku@0.6.0/uuid/v7'

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

type User = typeof User.Type

export const solve = (input: Omit<User, 'id'>): Promise<User> => {
  const program = Effect.gen(function* () {
    const user = Schema.decodeUnknownSync(User)({ ...input, id: uuidv7() })
    yield* Console.log(\`decoded \${user.id} for \${user.name}\`)
    return user
  })

  return Effect.runPromise(program)
}`

export const DEMO_CASES: readonly JudgeCase[] = [
  { name: 'creates a decoded user', exportName: 'solve', args: [{ name: 'runesm' }] },
  { name: 'creates another unique user', exportName: 'solve', args: [{ name: 'effect' }] },
]
