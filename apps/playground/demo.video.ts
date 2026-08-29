import { defineVideo } from 'termcut'
import { DEFAULT_CODE } from './src/examples'

const INSTALL_CODEMIRROR_HELPERS = `(() => {
  window.__demoSetCodeMirror = (selector, text) => {
    const target = document.querySelector(selector + ' .cm-content')
    if (!(target instanceof HTMLElement)) throw new Error('CodeMirror target is missing: ' + selector)
    target.focus()
    const selection = getSelection()
    const range = document.createRange()
    range.selectNodeContents(target)
    selection?.removeAllRanges()
    selection?.addRange(range)
    if (!document.execCommand('insertText', false, text)) throw new Error('could not replace CodeMirror text')
  }

  window.__demoPressCodeMirror = (selector, key, init = {}) => {
    const target = document.querySelector(selector + ' .cm-content')
    if (!(target instanceof HTMLElement)) throw new Error('CodeMirror target is missing: ' + selector)
    target.focus()
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, code: init.code ?? key, bubbles: true, cancelable: true, ...init }),
    )
  }
})()`

/**
 * Records the README demo GIF from the real playground.
 *
 * Uses the production preview build, not `vite dev`: the dev client is bundled
 * into the execution worker too, so its `[vite] connected.` log is captured as
 * real console output and shows up in the playground's output panel.
 *
 * Regenerate with `pnpm --filter playground demo`.
 */
export default defineVideo(
  {
    output: ['../../docs/media/playground.gif'],
    cols: 60,
    rows: 14,
    browser: { position: 'overlay', width: 1280, height: 800, offset: { x: 0, y: 0 } },
    requires: ['pnpm'],
    endPause: '2s',
  },
  async (t) => {
    // Everything up to a loaded page is cut, so the first frame of the GIF is
    // already the app rather than a shell prompt.
    await t.hide(async () => {
      await t.run('pnpm --filter playground build >/tmp/runesm-build.log 2>&1')
      await t.run('pnpm --filter playground preview </dev/null >/tmp/runesm-preview.log 2>&1 &')
      await t.clear()
      await t.browser.goto('http://localhost:4173/playground/')
      await t.browser.waitFor(/runesm playground/)
      await t.focus('browser')
      await t.browser.waitFor(/effect@beta\/Schema/)
      await t.browser.evaluate(`(() => {
        const editor = document.querySelector('#editor')
        const content = editor?.querySelector('.cm-content')
        if (!(editor instanceof HTMLDivElement) || !(content instanceof HTMLElement)) {
          throw new Error('CodeMirror editor markup is missing')
        }
        if (!content.textContent?.includes('type UserInput')) {
          throw new Error('TypeScript source is not visible in the editor')
        }
        const tokenColor = (text) => {
          const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
          let node = walker.nextNode()
          while (node) {
            if (node.textContent === text && node.parentElement) return getComputedStyle(node.parentElement).color
            node = walker.nextNode()
          }
          return ''
        }
        const tokenColors = new Set([tokenColor('type'), tokenColor('UserInput'), tokenColor("'effect@beta/Schema'")])
        if (tokenColors.has('') || tokenColors.size !== 3) {
          throw new Error('CodeMirror token categories do not have distinct syntax colors')
        }

      })()`)
      await t.browser.evaluate(INSTALL_CODEMIRROR_HELPERS)

      await t.browser.click('[data-language="mjs"]')
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#editor', 'export const solve = (input) => input * 2')
      })()`)
      await t.browser.click('#run')
      await t.browser.evaluate(`(async () => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (document.querySelector('.tape-status')?.textContent === 'pass') return
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error('.mjs source did not run directly')
      })()`)
      await t.browser.click('[data-language="ts"]')
      await t.browser.evaluate(`(() => {
        if (document.querySelector('[data-language="ts"]')?.getAttribute('aria-pressed') !== 'true') {
          throw new Error('TypeScript language selector did not activate')
        }
        window.__demoSetCodeMirror('#editor', 'Promise.')
        window.__demoPressCodeMirror('#editor', ' ', { code: 'Space', ctrlKey: true })
      })()`)
      await t.browser.evaluate(`(async () => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const menu = document.querySelector('.cm-tooltip-autocomplete')
          if (menu?.textContent?.includes('allSettled')) return
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error('editor completion did not include a TypeScript library member')
      })()`)
      await t.browser.evaluate(`(() => {
        window.__demoPressCodeMirror('#editor', 'Escape')
        window.__demoSetCodeMirror('#editor', ${JSON.stringify(DEFAULT_CODE)})
        window.__demoSetCodeMirror('#repl-input', 'sol')
        window.__demoPressCodeMirror('#repl-input', ' ', { code: 'Space', ctrlKey: true })
      })()`)
      await t.browser.evaluate(`(async () => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const menus = [...document.querySelectorAll('.cm-tooltip-autocomplete')]
          if (menus.some((menu) => menu.textContent?.includes('solve'))) return
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error('REPL completion did not include solve from the editor')
      })()`)
      await t.browser.evaluate(`(() => {
        window.__demoPressCodeMirror('#repl-input', 'Escape')
        window.__demoSetCodeMirror('#repl-input', 'missingFunction()')
        window.__demoPressCodeMirror('#repl-input', 'Enter')
      })()`)
      await t.browser.waitFor(/ReferenceError: missingFunction is not defined/)
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#repl-input', '1 + 1')
        window.__demoPressCodeMirror('#repl-input', 'Enter')
        window.__demoPressCodeMirror('#repl-input', 'ArrowUp')
        const historyValue = document.querySelector('#repl-input .cm-content')?.textContent
        if (historyValue !== '1 + 1') throw new Error('REPL ArrowUp did not restore command history')
        window.__demoPressCodeMirror('#repl-input', 'ArrowDown')
      })()`)
      await t.browser.waitFor(/= 2/)
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#repl-input', '((value: number) => value + 1)(41)')
        window.__demoPressCodeMirror('#repl-input', 'Enter')
      })()`)
      await t.browser.waitFor(/= 42/)
      await t.browser.click('#repl-reset')
      await t.browser.reload()
      await t.browser.waitFor(/effect@beta\/Schema/)
      await t.browser.evaluate(`(${INSTALL_CODEMIRROR_HELPERS}, (() => {
        window.__demoPressCodeMirror('#repl-input', 'ArrowRight')
        const suggestedValue = document.querySelector('#repl-input .cm-content')?.textContent
        if (suggestedValue !== "solve({ name: 'repl', age: 5 })") {
          throw new Error('REPL ArrowRight did not accept the inline suggestion')
        }
        window.__demoSetCodeMirror('#repl-input', '')
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        window.scrollTo(0, 0)
      })())`)
    })

    // Emit the prepared browser frame on the visible timeline.
    await t.focus('browser')
    await t.sleep('1.2s')

    // Judge: two cases against the Effect program in the editor.
    await t.browser.click('#judge')
    await t.browser.waitFor(/decoded runesm \(age 3\)/)
    await t.browser.waitFor(/decoded effect \(age 4\)/)
    await t.browser.waitFor(/greets another user/)
    await t.browser.evaluate(`(async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (document.querySelector('.tape-status')?.textContent === 'pass') return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('judge did not report a passing run')
    })()`)
    await t.sleep('1.5s')

    // REPL: the editor module seeds the scope, so its solve export is callable.
    await t.browser.evaluate(INSTALL_CODEMIRROR_HELPERS)
    await t.browser.evaluate(`(() => {
      window.__demoSetCodeMirror('#repl-input', "solve({ name: 'repl', age: 5 })")
      window.__demoPressCodeMirror('#repl-input', 'Enter')
    })()`)
    await t.browser.waitFor(/decoded repl \(age 5\)/)
    await t.browser.waitFor(/'hello, repl'/)
    await t.sleep('1.5s')
  },
)
