// Keep the v1 cache key stable while older pages and service workers can still
// control one another during a rolling deployment.
const MODULE_GRAPH_CACHE_PREFIX = 'esmwell:test-graph:v1:'

/** Cache name shared with the narrowly scoped module service worker. */
export const moduleGraphCacheName = (graphId: string): string => `${MODULE_GRAPH_CACHE_PREFIX}${graphId}`
