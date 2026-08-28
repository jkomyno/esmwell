/**
 * Real-browser integration harness for runesm, run with `bun`.
 *
 * Serves the built package plus a test page over localhost, opens it in a
 * headless WebView, and runs the page-side suite under `__tests__/browser/`
 * against the real module worker (worker URL pointed at the served build).
 * The suite's summary is retrieved with a single evaluate() call whose
 * expression is a promise resolving when the run finishes.
 *
 * Backends: the platform default (WKWebView on macOS, Chrome elsewhere).
 * Set RUNESM_WEBVIEW_BACKEND=webkit|chrome to override; BUN_CHROME_PATH
 * locates the Chrome binary.
 */
import { serve, WebView } from 'bun'
import { join, resolve } from 'node:path'
import { readdirSync } from 'node:fs'

const packageRoot = resolve(import.meta.dir, '..')
const buildRoot = join(packageRoot, 'build')
const browserTestsRoot = join(packageRoot, '__tests__', 'browser')

const OVERALL_TIMEOUT_MS = 120_000

interface PageTestResult {
  name: string
  status: 'pass' | 'fail'
  error?: string
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
    if (path.startsWith('/runesm/')) {
      return serveBuildFile(path.slice('/runesm/'.length))
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

const testModuleNames = readdirSync(browserTestsRoot)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => name.slice(0, -'.ts'.length))

const pageHtml = (): string => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>runesm browser tests</title></head>
  <body>
    <script>
      window.addEventListener('error', (event) => {
        console.error('page error:', event.message, 'at', event.filename, event.lineno)
      })
      window.addEventListener('unhandledrejection', (event) => {
        console.error('unhandled rejection:', String(event.reason))
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
 */
const runnerSource = (): string => `
const tests = []

globalThis.test = (name, fn) => tests.push({ name, fn })
globalThis.assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
globalThis.assertEqual = (actual, expected, message) => {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(message + ': expected ' + right + ' but got ' + left)
}

const moduleNames = ${JSON.stringify(testModuleNames)}
for (const moduleName of moduleNames) {
  await import('/tests/' + moduleName + '.js')
}

const results = []
for (const { name, fn } of tests) {
  try {
    await fn()
    results.push({ name, status: 'pass' })
  } catch (error) {
    results.push({ name, status: 'fail', error: String(error) })
  }
}

globalThis.__results = results
if (globalThis.__resolveResults) globalThis.__resolveResults(results)
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
  const requested = process.env.RUNESM_WEBVIEW_BACKEND
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
    if (globalThis.__results !== undefined) resolve(globalThis.__results)
    else globalThis.__resolveResults = resolve
  })
`)) as PageTestResult[]

clearTimeout(overallTimeout)
view.close()
server.stop(true)

let failed = 0
for (const result of summary ?? []) {
  if (result.status === 'pass') {
    console.log(`  ✓ ${result.name}`)
  } else {
    failed += 1
    console.error(`  × ${result.name}`)
    console.error(`    ${result.error ?? 'no error message'}`)
  }
}

console.log(`\nbrowser tests: ${summary.length - failed} passed, ${failed} failed`)
if (failed > 0 || (summary?.length ?? 0) === 0) {
  process.exitCode = 1
}
