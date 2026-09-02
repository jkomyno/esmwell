import { describe, expect, it } from 'vitest'
import { SourceLanguageState } from '../../src/source-language-state'

const INITIAL_TYPESCRIPT = 'const answer: number = 42'
const INITIAL_JAVASCRIPT = 'const answer = 42;\n'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('SourceLanguageState', () => {
  it('switches between TypeScript and its generated JavaScript without losing either source', () => {
    const state = new SourceLanguageState(INITIAL_TYPESCRIPT)

    expect(state.javascriptForCurrentTypeScript()).toBeUndefined()

    state.showJavaScript(INITIAL_JAVASCRIPT)
    expect(state.language).toBe('mjs')
    expect(state.source).toBe(INITIAL_JAVASCRIPT)

    expect(state.showTypeScript()).toBe(true)
    expect(state.language).toBe('ts')
    expect(state.source).toBe(INITIAL_TYPESCRIPT)
    expect(state.javascriptForCurrentTypeScript()).toBe(INITIAL_JAVASCRIPT)
  })

  it('invalidates generated JavaScript after the TypeScript source changes', () => {
    const state = new SourceLanguageState(INITIAL_TYPESCRIPT)
    state.showJavaScript(INITIAL_JAVASCRIPT)
    state.showTypeScript()

    state.edit('const answer: number = 43')

    expect(state.language).toBe('ts')
    expect(state.javascriptForCurrentTypeScript()).toBeUndefined()
    expect(state.dirty).toBe(true)
  })

  it('locks TypeScript after JavaScript is edited until both sources are restored', () => {
    const state = new SourceLanguageState(INITIAL_TYPESCRIPT)
    state.showJavaScript(INITIAL_JAVASCRIPT)
    state.edit('const answer = 43;\n')

    expect(state.language).toBe('mjs')
    expect(state.typeScriptAvailable).toBe(false)
    expect(state.showTypeScript()).toBe(false)

    state.reset()

    expect(state.language).toBe('ts')
    expect(state.source).toBe(INITIAL_TYPESCRIPT)
    expect(state.typeScriptAvailable).toBe(true)
    expect(state.dirty).toBe(false)
    expect(state.javascriptForCurrentTypeScript()).toBeUndefined()
  })

  it('discards a transpile failure after the TypeScript source changes', async () => {
    const state = new SourceLanguageState(INITIAL_TYPESCRIPT)
    const transpile = deferred<string>()

    const transition = state.showJavaScriptForCurrentTypeScript(() => transpile.promise)
    state.edit('const answer: number = 43')
    transpile.reject(new Error('failure for old source'))

    await expect(transition).resolves.toEqual({ status: 'source-changed' })
    expect(state.language).toBe('ts')
    expect(state.source).toBe('const answer: number = 43')
  })

  it('reports a source change instead of showing stale generated JavaScript', async () => {
    const state = new SourceLanguageState(INITIAL_TYPESCRIPT)
    const transpile = deferred<string>()

    const transition = state.showJavaScriptForCurrentTypeScript(() => transpile.promise)
    state.edit('const answer: number = 43')
    transpile.resolve(INITIAL_JAVASCRIPT)

    await expect(transition).resolves.toEqual({ status: 'source-changed' })
    expect(state.language).toBe('ts')
    expect(state.source).toBe('const answer: number = 43')
  })
})
