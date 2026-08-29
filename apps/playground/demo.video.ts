import { defineVideo } from 'termcut'
import { DEFAULT_CODE } from './src/examples'

const ZOD_INFERENCE_CODE = `import { z } from 'zod@4'

const UserInput = z.object({
  name: z.string(),
  age: z.number(),
})

type UserInput = z.infer<typeof UserInput>
`

const ZOD_COMPLETION_CODE = `import { z } from 'zod@4'

z.`

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

  window.__demoUndoCodeMirror = (selector) => {
    const target = document.querySelector(selector + ' .cm-content')
    if (!(target instanceof HTMLElement)) throw new Error('CodeMirror target is missing: ' + selector)
    target.focus()
    target.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }),
    )
  }

  window.__demoHoverCodeMirrorText = (selector, text) => {
    const content = document.querySelector(selector + ' .cm-content')
    if (!(content instanceof HTMLElement)) throw new Error('CodeMirror target is missing: ' + selector)
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const offset = node.textContent?.indexOf(text) ?? -1
      if (offset >= 0 && node.parentElement) {
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + text.length)
        const bounds = range.getBoundingClientRect()
        const init = {
          bubbles: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
        }
        node.parentElement.dispatchEvent(new MouseEvent('mouseover', init))
        node.parentElement.dispatchEvent(new MouseEvent('mousemove', init))
        return
      }
      node = walker.nextNode()
    }
    throw new Error('CodeMirror text is missing: ' + text)
  }

  window.__demoWaitFor = async (predicate, message, attempts = 60) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(message)
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
        if (!content.textContent?.includes('type UserInput = typeof UserInput.Type')) {
          throw new Error('TypeScript source is not visible in the editor')
        }
        const editorStage = document.querySelector('.editor-stage')
        const testsSummary = document.querySelector('.test-disclosure summary')
        const testsDisclosure = document.querySelector('.test-disclosure')
        const testDefinitions = document.querySelector('.test-definitions')
        if (
          !(editorStage instanceof HTMLElement) ||
          !(testsSummary instanceof HTMLElement) ||
          !(testsDisclosure instanceof HTMLDetailsElement) ||
          !(testDefinitions instanceof HTMLElement)
        ) {
          throw new Error('editor tests disclosure is missing')
        }
        const stageBounds = editorStage.getBoundingClientRect()
        const summaryBounds = testsSummary.getBoundingClientRect()
        const rightInset = stageBounds.right - summaryBounds.right
        const bottomInset = stageBounds.bottom - summaryBounds.bottom
        if (rightInset < 0 || rightInset > 20 || bottomInset < 0 || bottomInset > 20) {
          throw new Error('View tests is not anchored to the editor bottom-right')
        }
        const editorBounds = editor.getBoundingClientRect()
        if (summaryBounds.top < editorBounds.bottom) {
          throw new Error('View tests overlaps editable source')
        }
        testsDisclosure.open = true
        const definitionsBounds = testDefinitions.getBoundingClientRect()
        if (
          definitionsBounds.bottom > summaryBounds.top ||
          definitionsBounds.left < stageBounds.left ||
          definitionsBounds.right > stageBounds.right
        ) {
          throw new Error('test definitions do not open above the control inside the editor')
        }
        testsDisclosure.open = false
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

      await t.browser.evaluate(`(() => {
        window.__demoHoverCodeMirrorText('#editor', 'UserInput')
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info')?.textContent?.includes('Schema.Struct') === true,
          'Effect quick info did not load',
          90,
        )
        if (document.querySelector('.cm-typescript-info')?.textContent?.includes('any') === true) {
          throw new Error('Effect quick info resolved UserInput to any')
        }
      })()`)
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#editor', ${JSON.stringify(ZOD_INFERENCE_CODE)})
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info') === null,
          'Effect quick info remained visible after loading Zod source',
        )
      })()`)
      await t.browser.evaluate(`(() => {
        window.__demoHoverCodeMirrorText('#editor', 'UserInput')
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info')?.textContent?.includes('ZodObject') === true,
          'Zod quick info did not load',
          90,
        )
        if (document.querySelector('.cm-typescript-info')?.textContent?.includes('any') === true) {
          throw new Error('Zod quick info resolved UserInput to any')
        }
      })()`)
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#editor', ${JSON.stringify(ZOD_COMPLETION_CODE)})
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info') === null,
          'Zod quick info remained visible before completion check',
        )
        if (!document.execCommand('insertText', false, 'o')) {
          throw new Error('could not trigger Zod member completion')
        }
        await window.__demoWaitFor(
          () => document.querySelector('.cm-tooltip-autocomplete')?.textContent?.includes('object') === true,
          'Zod member completion did not load',
        )
        window.__demoPressCodeMirror('#editor', 'Escape', { code: 'Escape' })
      })()`)

      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#editor', 'const answer = 42')
        window.__demoHoverCodeMirrorText('#editor', 'answer')
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info')?.textContent?.includes('const answer: 42') === true,
          'hover did not show the inferred TypeScript type',
        )
        window.__demoSetCodeMirror('#editor', 'const answer = 43')
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info') === null,
          'type hover remained visible after the source changed',
        )
        window.__demoPressCodeMirror('#editor', 'Home', { code: 'Home' })
        for (let step = 0; step < 7; step += 1) {
          window.__demoPressCodeMirror('#editor', 'ArrowRight', { code: 'ArrowRight' })
        }
        window.__demoPressCodeMirror('#editor', 'h', {
          code: 'KeyH',
          metaKey: true,
          shiftKey: true,
        })
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info')?.textContent?.includes('const answer: 43') === true,
          'keyboard type help did not show the inferred TypeScript type',
        )
        window.__demoSetCodeMirror('#editor', ${JSON.stringify(DEFAULT_CODE)})
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info') === null,
          'type hover remained visible after the source changed',
        )
      })()`)

      await t.browser.evaluate(`(() => {
        const button = document.querySelector('[data-language="mjs"]')
        if (!(button instanceof HTMLButtonElement)) throw new Error('.mjs control is missing')
        button.focus()
      })()`)
      await t.browser.click('[data-language="mjs"]')
      await t.browser.evaluate(`(() => {
        const content = document.querySelector('#editor .cm-content')
        if (!(content instanceof HTMLElement) || document.activeElement !== content) {
          throw new Error('.mjs activation did not move focus to the editor before disabling its control')
        }
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(() => {
          const active = document.querySelector('[data-language="mjs"]')?.getAttribute('aria-pressed') === 'true'
          const source = document.querySelector('#editor .cm-content')?.textContent ?? ''
          return active && source.includes('const UserInput =') && !source.includes('type UserInput')
        }, '.mjs did not show generated JavaScript')
      })()`)
      await t.browser.evaluate(`(() => {
        const content = document.querySelector('#editor .cm-content')
        const typeScriptButton = document.querySelector('[data-language="ts"]')
        if (!(content instanceof HTMLElement) || !(typeScriptButton instanceof HTMLButtonElement)) {
          throw new Error('source language controls are missing')
        }
        const source = content.textContent
        window.__demoUndoCodeMirror('#editor')
        if (content.textContent !== source || typeScriptButton.disabled) {
          throw new Error('Undo crossed the TypeScript to JavaScript history boundary')
        }
      })()`)
      await t.browser.click('[data-language="ts"]')
      await t.browser.evaluate(`(() => {
        const source = document.querySelector('#editor .cm-content')?.textContent ?? ''
        if (!source.includes('type UserInput = typeof UserInput.Type')) {
          throw new Error('.ts did not restore TypeScript source')
        }
        window.__demoSetCodeMirror('#editor', 'export const typed: number = 42')
      })()`)
      await t.browser.click('[data-language="mjs"]')
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(() => {
          const source = document.querySelector('#editor .cm-content')?.textContent ?? ''
          return source.includes('export const typed = 42;') && !source.includes(': number')
        }, 'edited TypeScript did not regenerate JavaScript')
      })()`)
      await t.browser.click('[data-language="ts"]')
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#editor', 'export const broken: = 1')
      })()`)
      await t.browser.click('[data-language="mjs"]')
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(() => {
          const status = document.querySelector('#source-status')?.textContent ?? ''
          const stillTypeScript = document.querySelector('[data-language="ts"]')?.getAttribute('aria-pressed') === 'true'
          return stillTypeScript && status.includes('Cannot open .mjs')
        }, 'invalid TypeScript did not block .mjs')
      })()`)
      await t.browser.evaluate(`(() => {
        const button = document.querySelector('#source-reset')
        if (!(button instanceof HTMLButtonElement)) throw new Error('source restore control is missing')
        button.focus()
      })()`)
      await t.browser.click('#source-reset')
      await t.browser.evaluate(`(() => {
        const content = document.querySelector('#editor .cm-content')
        const sourceReset = document.querySelector('#source-reset')
        if (
          !(content instanceof HTMLElement) ||
          !(sourceReset instanceof HTMLButtonElement) ||
          document.activeElement !== content ||
          !sourceReset.disabled
        ) {
          throw new Error('source restore did not preserve visible focus when disabling itself')
        }
      })()`)
      await t.browser.click('[data-language="mjs"]')
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('[data-language="mjs"]')?.getAttribute('aria-pressed') === 'true',
          '.mjs did not activate after source restore',
        )
      })()`)
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#editor', 'export const solve = (input) => input * 2')
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(() => {
          const typeScriptButton = document.querySelector('[data-language="ts"]')
          const status = document.querySelector('#source-status')?.textContent ?? ''
          if (typeScriptButton instanceof HTMLButtonElement && typeScriptButton.disabled) {
            if (!status.includes('Restore the initial source')) {
              throw new Error('the JavaScript edit lock is not explained')
            }
            return true
          }
          return false
        }, 'editing JavaScript did not disable .ts')
      })()`)
      await t.browser.click('#run')
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('.tape-status')?.textContent === 'pass',
          '.mjs source did not run directly',
        )
      })()`)
      await t.browser.click('#source-reset')
      await t.browser.evaluate(`(() => {
        const content = document.querySelector('#editor .cm-content')
        const typeScriptButton = document.querySelector('[data-language="ts"]')
        const sourceReset = document.querySelector('#source-reset')
        if (
          !(content instanceof HTMLElement) ||
          !(typeScriptButton instanceof HTMLButtonElement) ||
          !(sourceReset instanceof HTMLButtonElement) ||
          typeScriptButton.getAttribute('aria-pressed') !== 'true'
        ) {
          throw new Error('source restore did not activate TypeScript')
        }
        const source = content.textContent
        window.__demoUndoCodeMirror('#editor')
        if (content.textContent !== source || typeScriptButton.disabled || !sourceReset.disabled) {
          throw new Error('Undo crossed the source restore history boundary')
        }
        window.__demoSetCodeMirror('#editor', 'Promise.')
        window.__demoPressCodeMirror('#editor', ' ', { code: 'Space', ctrlKey: true })
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(() => {
          const menu = document.querySelector('.cm-tooltip-autocomplete')
          return menu?.textContent?.includes('allSettled') === true
        }, 'editor completion did not include a TypeScript library member')
      })()`)
      await t.browser.evaluate(`(() => {
        window.__demoPressCodeMirror('#editor', 'Escape')
        window.__demoSetCodeMirror('#editor', ${JSON.stringify(DEFAULT_CODE)})
        window.__demoSetCodeMirror('#repl-input', 'sol')
        window.__demoPressCodeMirror('#repl-input', ' ', { code: 'Space', ctrlKey: true })
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(() => {
          const menus = [...document.querySelectorAll('.cm-tooltip-autocomplete')]
          return menus.some((menu) => menu.textContent?.includes('solve'))
        }, 'REPL completion did not include solve from the editor')
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
      await t.browser.evaluate(`(() => {
        window.__demoSetCodeMirror('#repl-input', "solve({ name: 'asd' })")
        window.__demoPressCodeMirror('#repl-input', 'Enter')
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () =>
            [...document.querySelectorAll('#repl-history .repl-line-error')].some((line) =>
              line.textContent?.includes('age'),
            ),
          'invalid solve input did not surface its missing age error',
        )
      })()`)
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
    await t.browser.evaluate(INSTALL_CODEMIRROR_HELPERS)

    // Reveal and run the two cases against the Effect program in the editor.
    await t.browser.click('.test-disclosure summary')
    await t.browser.waitFor(/solve\(\{"name":"runesm","age":3\}\)/)
    await t.browser.click('#judge')
    await t.browser.waitFor(/decoded runesm \(age 3\)/)
    await t.browser.waitFor(/decoded effect \(age 4\)/)
    await t.browser.waitFor(/greets another user/)
    await t.browser.evaluate(`(async () => {
      await window.__demoWaitFor(
        () => document.querySelector('.tape-status')?.textContent === 'pass',
        'judge did not report a passing run',
      )
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
