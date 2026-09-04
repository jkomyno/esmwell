import { afterEach, describe, expect, it, vi } from 'vitest'

type FetchListener = (event: { readonly request: Request; respondWith(response: Promise<Response>): void }) => void

describe('module service worker', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('does not recreate a deleted graph cache while serving a late request', async () => {
    let fetchListener: FetchListener | undefined
    const cacheMatch = vi.fn<() => Promise<Response | undefined>>(() => Promise.resolve(undefined))
    const open = vi.fn<() => Promise<{ match: typeof cacheMatch }>>(() => Promise.resolve({ match: cacheMatch }))
    const match = vi.fn<() => Promise<Response | undefined>>(() => Promise.resolve(undefined))

    vi.stubGlobal('self', {
      clients: { claim: vi.fn<() => Promise<void>>(() => Promise.resolve()) },
      skipWaiting: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      addEventListener: (type: string, listener: FetchListener): void => {
        if (type === 'fetch') fetchListener = listener
      },
    })
    vi.stubGlobal('caches', { open, match })

    await vi.importActual('../../src/module-service-worker')

    const request = new Request('https://example.test/__esmwell_graphs__/v1/abc-123/entry.mjs')
    let response: Promise<Response> | undefined
    fetchListener?.({ request, respondWith: (pending) => (response = pending) })

    await expect(response).resolves.toMatchObject({ status: 404 })
    expect(match).toHaveBeenCalledWith(request, { cacheName: 'esmwell:test-graph:v1:abc-123' })
    expect(open).not.toHaveBeenCalled()
  })
})
