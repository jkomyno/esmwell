import { requireRegisteredTests } from 'src/test-runner'
import type { NormalizedEngineOutcome } from 'src/test-runner'

const engine = { name: 'vitest' as const, version: '4.0.0', packages: [] }

describe('requireRegisteredTests', () => {
  it('turns a clean outcome with zero tests into a NoTestsError', () => {
    const outcome: NormalizedEngineOutcome = { ok: true, engine, tests: [] }
    const guarded = requireRegisteredTests(outcome)

    expect(guarded.ok).toBe(false)
    expect(guarded.error?.name).toBe('NoTestsError')
    expect(guarded.error?.message).toContain('registered no tests')
  })

  it('leaves an outcome with tests untouched', () => {
    const outcome: NormalizedEngineOutcome = {
      ok: true,
      engine,
      tests: [{ id: 't1', name: 'x', fullName: 'x', status: 'pass', durationMs: 1, errors: [] }],
    }

    expect(requireRegisteredTests(outcome)).toBe(outcome)
  })

  it('keeps an existing engine error instead of replacing it', () => {
    const outcome: NormalizedEngineOutcome = {
      ok: false,
      engine,
      tests: [],
      error: { name: 'Error', message: 'boom' },
    }

    expect(requireRegisteredTests(outcome)).toBe(outcome)
    expect(requireRegisteredTests(outcome).error?.name).toBe('Error')
  })
})
