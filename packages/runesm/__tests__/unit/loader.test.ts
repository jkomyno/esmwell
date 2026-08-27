import { createDataModuleUrl, createModuleUrl, importModule, readNamedExport } from 'src/loader'

describe('createModuleUrl', () => {
  it('prefers blob urls when createObjectURL is available', () => {
    const url = createModuleUrl('export const one = 1')
    expect(url.startsWith('blob:')).toBe(true)
    URL.revokeObjectURL(url)
  })

  it('falls back to data urls without createObjectURL', () => {
    const original = URL.createObjectURL
    try {
      URL.createObjectURL = undefined as unknown as typeof URL.createObjectURL
      const url = createModuleUrl('export const one = 1')
      expect(url.startsWith('data:text/javascript')).toBe(true)
    } finally {
      URL.createObjectURL = original
    }
  })
})

describe('createDataModuleUrl', () => {
  it('encodes arbitrary module sources safely', () => {
    const url = createDataModuleUrl("export const tricky = '\"quotes% and spaces'")
    expect(url.startsWith('data:text/javascript;charset=utf-8,')).toBe(true)
    expect(url).not.toContain(' ')
  })
})

describe('importModule', () => {
  it('imports named and default exports from a data url', async () => {
    const url = createDataModuleUrl('export const answer = 42\nexport default "the-default"')
    const mod = await importModule(url)

    expect(readNamedExport(mod, 'answer')).toEqual({ found: true, value: 42 })
    expect(readNamedExport(mod, 'default')).toEqual({ found: true, value: 'the-default' })
  })

  it('reports missing exports without throwing', async () => {
    const url = createDataModuleUrl('export const present = 1')
    const mod = await importModule(url)

    expect(readNamedExport(mod, 'absent')).toEqual({ found: false, value: undefined })
  })

  it('propagates module evaluation errors', async () => {
    const url = createDataModuleUrl('throw new Error("module blew up")')
    await expect(importModule(url)).rejects.toThrow('module blew up')
  })
})
