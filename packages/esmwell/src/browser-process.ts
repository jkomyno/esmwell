/** The browser-oriented subset of Node's process global exposed to user modules. */
export interface BrowserProcess {
  readonly browser: true
  readonly title: 'browser'
  readonly env: Record<string, string | undefined>
  readonly argv: string[]
  readonly version: ''
  readonly versions: Readonly<Record<string, string>>
  cwd(): '/'
  chdir(directory: string): never
  nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]): void
  on(event: string, listener: (...args: unknown[]) => void): BrowserProcess
  once(event: string, listener: (...args: unknown[]) => void): BrowserProcess
  off(event: string, listener: (...args: unknown[]) => void): BrowserProcess
  addListener(event: string, listener: (...args: unknown[]) => void): BrowserProcess
  removeListener(event: string, listener: (...args: unknown[]) => void): BrowserProcess
  emit(event: string, ...args: unknown[]): false
}

/** Creates the conventional process/browser shape without claiming to be Node. */
export function createBrowserProcess(): BrowserProcess {
  const process: BrowserProcess = {
    browser: true,
    title: 'browser',
    env: {},
    argv: [],
    version: '',
    versions: {},
    cwd: () => '/',
    chdir: (directory) => {
      throw new Error(`process.chdir('${directory}') is not supported in a browser worker`)
    },
    nextTick: (callback, ...args) => {
      queueMicrotask(() => callback(...args))
    },
    on: () => process,
    once: () => process,
    off: () => process,
    addListener: () => process,
    removeListener: () => process,
    emit: () => false,
  }
  return Object.freeze(process)
}

/** Installs one process object when the runtime does not already provide one. */
export function installBrowserProcess(): void {
  const target = globalThis as typeof globalThis & { process?: unknown }
  if (typeof target.process === 'object' && target.process !== null) {
    return
  }
  defineEsmwellGlobal('process', createBrowserProcess())
}

const PROCESS_MODULE_SOURCE = `
const process = globalThis.process
if (process === undefined) throw new Error('node:process loaded before the browser process global was installed')
export { process }
export default process
export const browser = process.browser
export const title = process.title
export const env = process.env
export const argv = process.argv
export const version = process.version
export const versions = process.versions
export const platform = process.platform
export const cwd = process.cwd
export const chdir = process.chdir
export const nextTick = process.nextTick
`.trim()

/** A self-contained ESM facade whose default and named exports use globalThis.process. */
export const browserProcessModuleUrl = (): string =>
  `data:text/javascript;charset=utf-8,${encodeURIComponent(PROCESS_MODULE_SOURCE)}`
import { defineEsmwellGlobal } from './runtime-globals'
