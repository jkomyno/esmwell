const GRAPH_PATH_MARKER = '/__esmwell_graphs__/v1/'
const CACHE_PREFIX = 'esmwell:test-graph:v1:'

interface ServiceWorkerScopeLike {
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
  addEventListener(type: 'install' | 'activate', listener: (event: LifetimeEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: RequestEvent) => void): void
}

interface LifetimeEvent {
  waitUntil(promise: Promise<unknown>): void
}

interface RequestEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}

const scope = self as unknown as ServiceWorkerScopeLike

scope.addEventListener('install', (event): void => {
  event.waitUntil(scope.skipWaiting())
})

scope.addEventListener('activate', (event): void => {
  event.waitUntil(scope.clients.claim())
})

scope.addEventListener('fetch', (event): void => {
  const graphId = graphIdFromUrl(event.request.url)
  if (graphId === undefined) {
    return
  }
  event.respondWith(
    caches
      .match(event.request, { cacheName: `${CACHE_PREFIX}${graphId}` })
      .then((response) => response ?? new Response('virtual module not found', { status: 404 })),
  )
})

const graphIdFromUrl = (url: string): string | undefined => {
  const pathname = new URL(url).pathname
  const markerAt = pathname.indexOf(GRAPH_PATH_MARKER)
  if (markerAt === -1) {
    return undefined
  }
  const rest = pathname.slice(markerAt + GRAPH_PATH_MARKER.length)
  const graphId = rest.split('/')[0]
  return graphId !== undefined && /^[a-f0-9-]+$/i.test(graphId) ? graphId : undefined
}
