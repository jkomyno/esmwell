/**
 * Real-browser integration harness for esmwell, run with `bun`.
 *
 * Serves the built package plus a test page over localhost, opens it in a
 * headless WebView, and runs the page-side suite under `__tests__/browser/`
 * against the real module worker (worker URL pointed at the served build).
 * The suite's summary is retrieved with a single evaluate() call whose
 * expression is a promise resolving when the run finishes.
 *
 * Backends: the platform default (WKWebView on macOS, Chrome elsewhere).
 * Set ESMWELL_WEBVIEW_BACKEND=webkit|chrome to override; BUN_CHROME_PATH
 * locates the Chrome binary.
 */
import { serve, WebView } from 'bun'
import { join, resolve } from 'node:path'
import { readdirSync } from 'node:fs'

const packageRoot = resolve(import.meta.dir, '..')
const buildRoot = join(packageRoot, 'build')
const browserTestsRoot = join(packageRoot, '__tests__', 'browser')

const OVERALL_TIMEOUT_MS = 300_000

interface PageTestResult {
  name: string
  status: 'pass' | 'fail'
  error?: string
}

interface PageModuleCount {
  name: string
  count: number
}

interface PageSummary {
  results: PageTestResult[]
  moduleCounts: PageModuleCount[]
}

const javascriptType = 'text/javascript; charset=utf-8'

const server = serve({
  port: 0,
  async fetch(request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/') {
      return new Response(pageHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (path === '/runner.js') {
      return new Response(runnerSource(), { headers: { 'content-type': javascriptType } })
    }
    if (path.startsWith('/esmwell/')) {
      return serveBuildFile(path.slice('/esmwell/'.length))
    }
    if (path === '/deps/acorn.mjs') {
      return serveFile(packageRoot, 'node_modules/acorn/dist/acorn.mjs')
    }
    if (path.startsWith('/tests/')) {
      const fileName = `${path.slice('/tests/'.length).replace(/\.js$/, '')}.ts`
      return serveFile(browserTestsRoot, fileName, { transpile: true })
    }
    return new Response('not found', { status: 404 })
  },
})

const serveFile = async (root: string, relativePath: string, options?: { transpile?: boolean }): Promise<Response> => {
  const filePath = resolve(root, relativePath)
  if (!filePath.startsWith(resolve(root))) {
    return new Response('forbidden', { status: 403 })
  }
  if (options?.transpile === true) {
    // Bun.Transpiler strips types; the page imports the result as a module.
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const source = await Bun.file(filePath).text()
    return new Response(transpiler.transformSync(source), {
      headers: { 'content-type': javascriptType },
    })
  }
  return new Response(Bun.file(filePath), { headers: { 'content-type': javascriptType } })
}

/**
 * The published build keeps acorn external (the size budget excludes it), so
 * raw-serving it needs the bare specifier pointed at a served copy — the
 * same way bundlers and CDNs provide it for other consumers.
 */
const serveBuildFile = async (relativePath: string): Promise<Response> => {
  const source = await Bun.file(join(buildRoot, relativePath)).text()
  const rewritten = source.replace(/(from\s*)(["'])acorn\2/g, '$1$2/deps/acorn.mjs$2')
  return new Response(rewritten, { headers: { 'content-type': javascriptType } })
}

// Recursive so a test file in a subdirectory is discovered rather than
// silently dropped from the suite.
const testModuleNames = (readdirSync(browserTestsRoot, { recursive: true }) as string[])
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => name.replace(/\\/g, '/').slice(0, -'.ts'.length))

const pageHtml = (): string => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>esmwell browser tests</title></head>
  <body>
    <script>
      // Collected here (rather than only logged) so the runner can turn a
      // page-level error or a late rejection into a failing result: neither
      // is visible to the micro test-runner, which only sees exceptions
      // thrown synchronously out of an awaited test body.
      globalThis.__pageErrors = []
      window.addEventListener('error', (event) => {
        const message = 'page error: ' + event.message + ' at ' + event.filename + ':' + event.lineno
        console.error(message)
        globalThis.__pageErrors.push(message)
      })
      window.addEventListener('unhandledrejection', (event) => {
        const message = 'unhandled rejection: ' + String(event.reason)
        console.error(message)
        globalThis.__pageErrors.push(message)
      })
    </script>
    <script type="module" src="/runner.js"></script>
  </body>
</html>`

/**
 * The page-side micro test-runner: registers tests via globalThis.test,
 * imports each transpiled test module, runs them sequentially, and resolves
 * globalThis.__results (the harness awaits exactly this promise). The test
 * module names are baked in when the harness serves this script.
 *
 * Guards against three ways a suite can shrink or hang silently:
 * - A module that throws on import is caught per-module and recorded as a
 *   failing result, instead of aborting this whole top-level script (which
 *   would leave globalThis.__results unset and stall the harness until
 *   OVERALL_TIMEOUT_MS).
 * - A module that registers zero tests (wrong suffix, empty file, a
 *   registration call that silently no-ops) is caught by diffing the
 *   registered-test count before/after each import.
 * - A page-level error or unhandled rejection collected into
 *   globalThis.__pageErrors (see pageHtml) is turned into a synthetic
 *   failing result before globalThis.__results is published.
 * A top-level try/catch is a last-resort net: any other unexpected throw
 * still publishes a (failing) result instead of hanging the harness.
 */
const runnerSource = (): string => `
const tests = []
const moduleCounts = []
const results = []

globalThis.test = (name, fn) => tests.push({ name, fn })
globalThis.assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
globalThis.assertEqual = (actual, expected, message) => {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(message + ': expected ' + right + ' but got ' + left)
}

const publish = () => {
  const summary = { results, moduleCounts }
  globalThis.__results = results
  globalThis.__moduleCounts = moduleCounts
  if (globalThis.__resolveSummary) globalThis.__resolveSummary(summary)
}

try {
  const moduleNames = ${JSON.stringify(testModuleNames)}
  for (const moduleName of moduleNames) {
    const before = tests.length
    try {
      await import('/tests/' + moduleName + '.js')
    } catch (error) {
      moduleCounts.push({ name: moduleName, count: 0 })
      results.push({ name: moduleName + ' (import)', status: 'fail', error: 'module failed to import: ' + String(error) })
      continue
    }
    const registered = tests.length - before
    moduleCounts.push({ name: moduleName, count: registered })
    if (registered === 0) {
      results.push({ name: moduleName + ' (registration)', status: 'fail', error: 'module registered zero tests' })
    }
  }

  for (const { name, fn } of tests) {
    try {
      await fn()
      results.push({ name, status: 'pass' })
    } catch (error) {
      results.push({ name, status: 'fail', error: String(error) })
    }
  }

  // Give a same-tick error/rejection a chance to land in __pageErrors before
  // it is read below.
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (const pageError of globalThis.__pageErrors ?? []) {
    results.push({ name: pageError, status: 'fail', error: pageError })
  }

  publish()
} catch (error) {
  results.push({ name: 'runner', status: 'fail', error: 'runner crashed: ' + String(error) })
  publish()
}
`

const formatConsoleArg = (argument: unknown): string => {
  if (typeof argument === 'string') {
    return argument
  }
  if (typeof argument === 'object' && argument !== null && 'description' in argument) {
    return String((argument as { description?: unknown }).description)
  }
  try {
    return JSON.stringify(argument) ?? String(argument)
  } catch {
    return String(argument)
  }
}

const backendOption = (): { backend?: string } => {
  const requested = process.env.ESMWELL_WEBVIEW_BACKEND
  if (requested === 'webkit' || requested === 'chrome') {
    return { backend: requested }
  }
  return {}
}

const view = new WebView({
  ...backendOption(),
  console: (level, ...args) => {
    const line = args.map(formatConsoleArg).join(' ')
    if (level === 'error' || level === 'warn') {
      console.error(`[page:${level}] ${line}`)
    } else {
      console.log(`[page:${level}] ${line}`)
    }
  },
})

const overallTimeout = setTimeout(() => {
  console.error('browser test suite did not finish in time')
  view.close()
  server.stop(true)
  process.exitCode = 1
}, OVERALL_TIMEOUT_MS)

await view.navigate(`http://localhost:${server.port}/`)

// One final promise: evaluate() is single-flight, so the harness makes
// exactly one call whose expression resolves when the suite completes.
const summary = (await view.evaluate(`
  new Promise((resolve) => {
    if (globalThis.__results !== undefined) resolve({ results: globalThis.__results, moduleCounts: globalThis.__moduleCounts ?? [] })
    else globalThis.__resolveSummary = resolve
  })
`)) as PageSummary | undefined

clearTimeout(overallTimeout)
view.close()
server.stop(true)

const results = summary?.results ?? []
const moduleCounts = summary?.moduleCounts ?? []

console.log('\nmodules:')
for (const moduleCount of moduleCounts) {
  console.log(`  ${moduleCount.name}: ${moduleCount.count} test(s)`)
}

let failed = 0
for (const result of results) {
  if (result.status === 'pass') {
    console.log(`  ✓ ${result.name}`)
  } else {
    failed += 1
    console.error(`  × ${result.name}`)
    console.error(`    ${result.error ?? 'no error message'}`)
  }
}

console.log(`\nbrowser tests: ${results.length - failed} passed, ${failed} failed`)
if (failed > 0 || results.length === 0) {
  process.exitCode = 1
}
