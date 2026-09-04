# Composition primitives

`createEsmwell`, `createReplSession`, and `createTestSession` are the supported way to run user code. The package also exports the lower-level pieces they are built from, for hosts that want to compose their own pipeline: lint submitted code without executing it, or list the bare imports a snippet would need before running it. The [playground](../../apps/playground) uses the latter to show a dependency list before a run.

## Parsing and inspecting a module

- `parseUserModule(code)` parses into an acorn AST and throws `UserSyntaxError` on invalid syntax.
- `checkPolicy(ast)` returns the `PolicyViolation`s in a parsed module.
- `collectBareSpecifiers(ast)` lists the bare import specifiers a parsed module references.
- `resolveDependencies` and `resolveImportSpecifier` resolve bare specifiers to CDN URLs and throw `SpecifierResolutionError` on failure.

These compose by chaining return values, so a host never has to name the acorn `Node` or `Program` types:

```ts
import { checkPolicy, collectBareSpecifiers, parseUserModule } from 'esmwell'

const ast = parseUserModule(code)
const violations = checkPolicy(ast)
const imports = collectBareSpecifiers(ast)
```

If you do want to type an intermediate AST value yourself, add `acorn` as a direct dependency. This package does not re-export its types.

## Classifying a specifier

A host that only needs to classify a specifier, without resolving it, can import the predicate from `esmwell/utils`. That subpath pulls in none of the runner:

```ts
import { isBareSpecifier } from 'esmwell/utils'

isBareSpecifier('zod@4') // true: a package name, possibly versioned, scoped, or with a subpath
isBareSpecifier('./local.js') // false: relative, absolute, `#imports`, and full URLs are all not bare
```

## Console formatting

`formatConsoleArguments(args)` and `serializeValue(value)` are the exact rendering the runner applies to captured console output. A host that prints console calls from its own workers, such as a compiler or a linter, can show them the same way.

## Worker RPC

`createWorkerRpc` and `serveWorkerRpc` are request/response plumbing for a worker the host owns: correlation ids, a pending map, rejection of in-flight requests when the worker fails, lazy start, `restart()` and `destroy()`, and an `AbortSignal` per request. The worker side routes each request body to one handler and posts its value or error back.

```ts
// page
import { createWorkerRpc } from 'esmwell/utils'

const compiler = createWorkerRpc<{ source: string }>({
  createWorker: () => new Worker(new URL('./compile-worker.js', import.meta.url), { type: 'module' }),
})
const { code } = await compiler.request<{ code: string }>({ source })

// compile-worker.js
import { serveWorkerRpc } from 'esmwell/utils'

serveWorkerRpc<{ source: string }>(({ source }) => ({ code: compile(source) }))
```

The playground's TypeScript language-service worker is built on this pair.
