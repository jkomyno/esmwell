import { jestEngineUrls, jestPackageUrls, parseJestVersion } from 'src/test-engines/jest'
import { parseVitestRunnerVersion, vitestEngineUrls, vitestPackageUrls } from 'src/test-engines/vitest'

describe('vitestEngineUrls', () => {
  it('probes the default latest dist-tag', () => {
    expect(vitestEngineUrls('latest')).toBe('https://esm.sh/@vitest/runner@latest')
  })

  it('probes a version range', () => {
    expect(vitestEngineUrls('5')).toBe('https://esm.sh/@vitest/runner@5')
  })

  it('probes an exact version', () => {
    expect(vitestEngineUrls('5.0.0')).toBe('https://esm.sh/@vitest/runner@5.0.0')
  })
})

describe('vitestPackageUrls', () => {
  it('derives the vitest/@vitest/runner/@vitest/expect URLs from a resolved version', () => {
    expect(vitestPackageUrls('5.0.3')).toEqual({
      vitestUrl: 'https://esm.sh/vitest@5.0.3',
      runnerUrl: 'https://esm.sh/@vitest/runner@5.0.3',
      expectUrl: 'https://esm.sh/@vitest/expect@5.0.3',
    })
  })
})

describe('parseVitestRunnerVersion', () => {
  it('reports the exact version esm.sh resolved through x-esm-path, not the requested range', () => {
    expect(parseVitestRunnerVersion('/@vitest/runner@5.0.3/dist/index.js')).toBe('5.0.3')
  })

  it('returns undefined for a path that does not match the expected shape', () => {
    expect(parseVitestRunnerVersion('/vitest@5.0.3/dist/index.js')).toBeUndefined()
  })
})

describe('jestEngineUrls', () => {
  it('probes the default latest dist-tag', () => {
    expect(jestEngineUrls('latest')).toBe('https://esm.sh/jest-circus@latest')
  })

  it('probes a version range', () => {
    expect(jestEngineUrls('30')).toBe('https://esm.sh/jest-circus@30')
  })

  it('probes an exact version', () => {
    expect(jestEngineUrls('30.0.0')).toBe('https://esm.sh/jest-circus@30.0.0')
  })
})

describe('jestPackageUrls', () => {
  it('derives the jest-circus/expect/jest-mock bundle URLs from a resolved version', () => {
    expect(jestPackageUrls('30.0.5')).toEqual({
      circus: 'https://esm.sh/jest-circus@30.0.5?bundle&target=es2022',
      expect: 'https://esm.sh/expect@30.0.5?bundle&target=es2022',
      mock: 'https://esm.sh/jest-mock@30.0.5?bundle&target=es2022',
    })
  })
})

describe('parseJestVersion', () => {
  it('reports the exact version esm.sh resolved through x-esm-path, not the requested range', () => {
    expect(parseJestVersion('/jest-circus@30.0.5/dist/index.js')).toBe('30.0.5')
  })

  it('throws when esm.sh reports an unexpected module path', () => {
    expect(() => parseJestVersion('/jest@30.0.5/dist/index.js')).toThrow('unexpected Jest module path')
  })
})
