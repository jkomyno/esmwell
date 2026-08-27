import { createDataModuleUrl, createModuleUrl, importModule, readNamedExport } from 'src/loader'

describe('createModuleUrl', () => {
  it('uses data urls in non-browser realms, even with createObjectURL present', () => {
    const url = createModuleUrl('export const one = 1')
    expect(url.startsWith('data:text/javascript')).toBe(true)
  })

  it('uses blob urls in browser realms with createObjectURL available', () => {
    const originalWindow = (globalThis as { window?: unknown }).window
    try {
      ;(globalThis as { window?: unknown }).window = {}
      const url = createModuleUrl('export const one = 1')
      expect(url.startsWith('blob:')).toBe(true)
      URL.revokeObjectURL(url)
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        ;(globalThis as { window?: unknown }).window = originalWindow
      }
    }
  })

  it('falls back to data urls in browser realms without createObjectURL', () => {
    const originalWindow = (globalThis as { window?: unknown }).window
    const originalCreateObjectURL = URL.createObjectURL
    try {
      ;(globalThis as { window?: unknown }).window = {}
      URL.createObjectURL = undefined as unknown as typeof URL.createObjectURL
      const url = createModuleUrl('export const one = 1')
      expect(url.startsWith('data:text/javascript')).toBe(true)
    } finally {
      URL.createObjectURL = originalCreateObjectURL
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        ;(globalThis as { window?: unknown }).window = originalWindow
      }
    }
  })
})

describe('createDataModuleUrl', () => {
  it('produces base64 urls safe to embed in generated imports', () => {
    const url = createDataModuleUrl("export const tricky = '\"quotes% and spaces'")
    expect(url.startsWith('data:text/javascript;base64,')).toBe(true)
    expect(url).not.toContain(' ')
    expect(url).not.toContain("'")
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
