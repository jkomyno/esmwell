import { createEsmwell } from 'src/main'
import type { WorkerFactory, WorkerLike } from 'src/main'
import { TypeScriptSyntaxError, TypeScriptUnavailableError, typescriptTransform } from 'src/typescript'
import type { TypeScriptCompiler } from 'src/typescript'
import type { WorkerRequest, WorkerResponse } from 'src/types'
import { vi } from 'vitest'

const loadTypeScript = () => import('typescript-legacy')

/** The API object itself, whichever shape the namespace import took. */
const loadCompilerObject = async (): Promise<TypeScriptCompiler> => {
  const namespace: unknown = await loadTypeScript()
  const candidate = (namespace as { default?: unknown }).default ?? namespace
  return candidate as TypeScriptCompiler
}

const failureOf = async (pending: Promise<unknown> | unknown): Promise<unknown> => {
  try {
    await pending
    return undefined
  } catch (error) {
    return error
  }
}

describe('typescriptTransform: compilation', () => {
  it('strips types and keeps ESM shape for a judge module', async () => {
    const transform = typescriptTransform({ load: loadTypeScript })

    const output = await transform(
      `import type { Foo } from './foo'
export const solve = (value: number): number => value * 2
interface User { name: string }
export const user: User = { name: 'a' }`,
      { kind: 'judge' },
    )

    expect(output).toContain('export const solve = (value) => value * 2')
    expect(output).toContain("export const user = { name: 'a' }")
    expect(output).not.toContain('import type')
    expect(output).not.toContain('interface')
  })

  it('emits expression statements unchanged for REPL inputs', async () => {
    const transform = typescriptTransform({ load: loadTypeScript })

    await expect(transform('1 + 1', { kind: 'repl' })).resolves.toBe('1 + 1;\n')
    await expect(transform('((value: number) => value + 1)(41)', { kind: 'repl' })).resolves.toBe(
      '((value) => value + 1)(41);\n',
    )
  })

  it('accepts the API object as well as a module namespace', async () => {
    const fromObject = typescriptTransform({ load: loadCompilerObject })
    const fromNamespace = typescriptTransform({ load: async () => ({ default: await loadCompilerObject() }) })

    await expect(fromObject('let n: number = 1', { kind: 'repl' })).resolves.toBe('let n = 1;\n')
    await expect(fromNamespace('let n: number = 1', { kind: 'repl' })).resolves.toBe('let n = 1;\n')
  })

  it('merges caller compiler options over the defaults', async () => {
    const transform = typescriptTransform({ load: loadTypeScript, compilerOptions: { removeComments: true } })

    await expect(transform('// gone\nconst a = 1', { kind: 'repl' })).resolves.toBe('const a = 1;\n')
  })

  it('loads the compiler once for many inputs', async () => {
    let loads = 0
    const transform = typescriptTransform({
      load: () => {
        loads += 1
        return loadTypeScript()
      },
    })

    await Promise.all([transform('a', { kind: 'repl' }), transform('b', { kind: 'repl' })])
    await transform('c', { kind: 'repl' })

    expect(loads).toBe(1)
  })
})

describe('typescriptTransform: failures', () => {
  it('reports a syntax diagnostic with its code and position', async () => {
    const transform = typescriptTransform({ load: loadTypeScript })

    const failure = await failureOf(transform('const ok = 1\nconst broken: = 1', { kind: 'judge' }))

    expect(failure).toBeInstanceOf(TypeScriptSyntaxError)
    expect(failure).toMatchObject({ name: 'TypeScriptError', code: 1110, line: 2, column: 14 })
    expect((failure as Error).message).toMatch(/^TS1110: Type expected/)
  })

  it('does not block a run on type errors, since transpileModule never type-checks', async () => {
    const transform = typescriptTransform({ load: loadTypeScript })

    await expect(transform('const n: number = "text"', { kind: 'judge' })).resolves.toBe('const n = "text";\n')
  })

  it('names the missing compiler when load rejects, and retries on the next run', async () => {
    let attempts = 0
    const transform = typescriptTransform({
      load: () => {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error('Cannot find module typescript')) : loadTypeScript()
      },
    })

    const failure = await failureOf(transform('const a = 1', { kind: 'judge' }))
    expect(failure).toBeInstanceOf(TypeScriptUnavailableError)
    expect((failure as Error).message).toContain('install the `typescript` package')
    expect((failure as Error).cause).toMatchObject({ message: 'Cannot find module typescript' })

    await expect(transform('const a = 1', { kind: 'judge' })).resolves.toBe('const a = 1;\n')
    expect(attempts).toBe(2)
  })

  it('rejects a module that is not a TypeScript compiler', async () => {
    const transform = typescriptTransform({ load: () => ({ version: '1.0.0' }) })

    await expect(transform('const a = 1', { kind: 'judge' })).rejects.toBeInstanceOf(TypeScriptUnavailableError)
  })
})

class FakeWorker implements WorkerLike {
  readonly sent: WorkerRequest[] = []
  private readonly listeners = new Set<(event: unknown) => void>()

  send(message: unknown): void {
    this.sent.push(message as WorkerRequest)
  }

  terminate(): void {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (type === 'message') this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: (event: unknown) => void): void {
    this.listeners.delete(listener)
  }

  emit(response: WorkerResponse): void {
    for (const listener of this.listeners) listener({ data: response })
  }
}

describe('typescriptTransform: through a session', () => {
  it('sends compiled JavaScript to the worker and surfaces syntax errors as results', async () => {
    const worker = new FakeWorker()
    const workerFactory: WorkerFactory = () => worker
    const session = createEsmwell({ workerFactory, transform: typescriptTransform({ load: loadTypeScript }) })

    const pending = session.runJudge('export const solve = (n: number) => n', [])
    await vi.waitFor(() => expect(worker.sent).toHaveLength(1))
    expect(worker.sent[0]).toMatchObject({ kind: 'judge', code: 'export const solve = (n) => n;\n' })
    worker.emit({
      kind: 'result',
      id: 1,
      result: { status: 'pass', ok: true, cases: [], console: [], dependencies: [], durationMs: 1 },
    })
    await expect(pending).resolves.toMatchObject({ status: 'pass' })

    const failed = await session.runJudge('export const broken: = 1', [])
    expect(failed.status).toBe('error')
    expect(failed.error).toMatchObject({ name: 'TypeScriptError', line: 1, column: 21 })
    expect(worker.sent).toHaveLength(1)
  })
})
