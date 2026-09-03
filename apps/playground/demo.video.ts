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
  const cmContent = (selector) => {
    const target = document.querySelector(selector + ' .cm-content')
    if (!(target instanceof HTMLElement)) throw new Error('CodeMirror target is missing: ' + selector)
    return target
  }

  window.__demoSetCodeMirror = (selector, text) => {
    const target = cmContent(selector)
    target.focus()
    const selection = getSelection()
    const range = document.createRange()
    range.selectNodeContents(target)
    selection?.removeAllRanges()
    selection?.addRange(range)
    if (!document.execCommand('insertText', false, text)) throw new Error('could not replace CodeMirror text')
  }

  window.__demoPressCodeMirror = (selector, key, init = {}) => {
    const target = cmContent(selector)
    target.focus()
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, code: init.code ?? key, bubbles: true, cancelable: true, ...init }),
    )
  }

  window.__demoUndoCodeMirror = (selector) => {
    const target = cmContent(selector)
    target.focus()
    target.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }),
    )
  }

  window.__demoHoverCodeMirrorText = (selector, text, line) => {
    const content = cmContent(selector)
    const root = line === undefined ? content : content.querySelectorAll('.cm-line')[line - 1]
    if (!(root instanceof HTMLElement)) throw new Error('CodeMirror line is missing: ' + line)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
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
    throw new Error('CodeMirror text is missing: ' + text + (line === undefined ? '' : ' on line ' + line))
  }

  // The recorder has no pointer of its own, so the visible timeline draws one:
  // a cursor that travels to its target and fires the mouse events a real
  // pointer would, so hover tooltips open and close on camera as they do live.
  const pointer = () => {
    let cursor = document.querySelector('#demo-pointer')
    if (cursor instanceof HTMLElement) return cursor
    cursor = document.createElement('div')
    cursor.id = 'demo-pointer'
    cursor.style.cssText =
      'position:fixed;left:0;top:0;width:18px;height:24px;pointer-events:none;z-index:2147483647;will-change:transform;'
    cursor.innerHTML =
      '<svg width="18" height="24" viewBox="0 0 18 24" fill="none"><path d="M2 2L2 19.5L6.5 15.5L9.5 22L12.5 20.5L9.5 14L15.5 14L2 2Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    cursor.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))'
    document.body.appendChild(cursor)
    window.__demoPointerAt = { x: innerWidth * 0.62, y: innerHeight * 0.55 }
    cursor.style.transform = 'translate(' + window.__demoPointerAt.x + 'px,' + window.__demoPointerAt.y + 'px)'
    return cursor
  }

  const mouseInit = (x, y, extra = {}) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra })

  const emitMove = (x, y) => {
    const target = document.elementFromPoint(x, y)
    const editor = target?.closest('.cm-editor') ?? null
    const previous = window.__demoPointerEditor ?? null
    if (previous && previous !== editor) previous.dispatchEvent(new MouseEvent('mouseleave', mouseInit(x, y)))
    if (editor && previous !== editor) editor.dispatchEvent(new MouseEvent('mouseenter', mouseInit(x, y)))
    window.__demoPointerEditor = editor
    target?.dispatchEvent(new MouseEvent('mousemove', mouseInit(x, y)))
  }

  window.__demoMovePointer = (x, y, duration = 480) =>
    new Promise((resolve) => {
      const cursor = pointer()
      const from = { ...window.__demoPointerAt }
      const start = performance.now()
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration)
        const eased = ease(progress)
        const cx = from.x + (x - from.x) * eased
        const cy = from.y + (y - from.y) * eased
        window.__demoPointerAt = { x: cx, y: cy }
        cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px)'
        emitMove(cx, cy)
        if (progress < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })

  window.__demoClick = async (selector) => {
    const element = document.querySelector(selector)
    if (!(element instanceof HTMLElement)) throw new Error('click target is missing: ' + selector)
    const bounds = element.getBoundingClientRect()
    const x = bounds.left + bounds.width / 2
    const y = bounds.top + bounds.height / 2
    await window.__demoMovePointer(x, y)
    const ring = document.createElement('div')
    ring.style.cssText =
      'position:fixed;width:28px;height:28px;border-radius:50%;border:2px solid rgba(17,17,17,0.55);pointer-events:none;z-index:2147483646;transform:translate(-50%,-50%) scale(0.3);opacity:1;transition:transform 260ms ease-out,opacity 260ms ease-out;left:' +
      x + 'px;top:' + y + 'px;'
    document.body.appendChild(ring)
    requestAnimationFrame(() => {
      ring.style.transform = 'translate(-50%,-50%) scale(1)'
      ring.style.opacity = '0'
    })
    setTimeout(() => ring.remove(), 320)
    element.dispatchEvent(new MouseEvent('mousedown', mouseInit(x, y, { button: 0 })))
    element.dispatchEvent(new MouseEvent('mouseup', mouseInit(x, y, { button: 0 })))
    element.click()
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  window.__demoHoverWithPointer = async (selector, text, line) => {
    const content = cmContent(selector)
    const root = line === undefined ? content : content.querySelectorAll('.cm-line')[line - 1]
    if (!(root instanceof HTMLElement)) throw new Error('CodeMirror line is missing: ' + line)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const offset = node.textContent?.indexOf(text) ?? -1
      if (offset >= 0 && node.parentElement) {
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + text.length)
        const bounds = range.getBoundingClientRect()
        const x = bounds.left + bounds.width / 2
        const y = bounds.top + bounds.height / 2
        await window.__demoMovePointer(x, y)
        node.parentElement.dispatchEvent(new MouseEvent('mouseover', mouseInit(x, y)))
        node.parentElement.dispatchEvent(new MouseEvent('mousemove', mouseInit(x, y)))
        return
      }
      node = walker.nextNode()
    }
    throw new Error('CodeMirror text is missing: ' + text + (line === undefined ? '' : ' on line ' + line))
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
        if (!content.textContent?.includes('type User = typeof User.Type')) {
          throw new Error('TypeScript source is not visible in the editor')
        }
        if (content.textContent.includes('//')) {
          throw new Error('default TypeScript source still contains comments')
        }
        const editorStage = document.querySelector('.editor-stage')
        const editorFooter = document.querySelector('.editor-footer')
        const runBar = document.querySelector('.run-bar')
        const consoleWell = document.querySelector('#console')
        const wordmark = document.querySelector('.wordmark')
        const claim = document.querySelector('.claim')
        const editorHead = document.querySelector('#label-editor')?.parentElement
        const outputHead = document.querySelector('#label-output')?.parentElement
        const replHead = document.querySelector('#label-repl')?.parentElement
        const replShortcuts = document.querySelector('#repl-shortcuts')
        const replActions = document.querySelector('#repl-reset')?.parentElement
        const editorShortcuts = document.querySelector('#editor-shortcuts')
        const editorCursor = document.querySelector('#editor-cursor')
        const testsSummary = document.querySelector('.test-drawer-handle')
        const testsDisclosure = document.querySelector('.test-drawer')
        const testDefinitions = document.querySelector('.test-definitions')
        const testCount = document.querySelector('#test-count')
        if (
          !(editorStage instanceof HTMLElement) ||
          !(editorFooter instanceof HTMLElement) ||
          !(runBar instanceof HTMLElement) ||
          !(consoleWell instanceof HTMLElement) ||
          !(wordmark instanceof HTMLElement) ||
          !(claim instanceof HTMLElement) ||
          !(editorHead instanceof HTMLElement) ||
          !(outputHead instanceof HTMLElement) ||
          !(replHead instanceof HTMLElement) ||
          !(replShortcuts instanceof HTMLElement) ||
          !(replActions instanceof HTMLElement) ||
          !(editorShortcuts instanceof HTMLElement) ||
          !(editorCursor instanceof HTMLElement) ||
          !(testsSummary instanceof HTMLElement) ||
          !(testsDisclosure instanceof HTMLDetailsElement) ||
          !(testDefinitions instanceof HTMLElement) ||
          !(testCount instanceof HTMLElement)
        ) {
          throw new Error('editor tests drawer is missing')
        }
        const stageBounds = editorStage.getBoundingClientRect()
        const footerBounds = editorFooter.getBoundingClientRect()
        const shortcutsBounds = editorShortcuts.getBoundingClientRect()
        const cursorBounds = editorCursor.getBoundingClientRect()
        const summaryBounds = testsSummary.getBoundingClientRect()
        if (testCount.textContent !== '2') {
          throw new Error('the tests drawer does not announce its case count')
        }
        // The handle is a full-width rail inside the well, not a control floating on it.
        if (Math.abs(summaryBounds.left - stageBounds.left) > 1 || Math.abs(summaryBounds.right - stageBounds.right) > 1) {
          throw new Error('the tests drawer handle does not span the editor well')
        }
        const summaryBackground = getComputedStyle(testsSummary).backgroundColor
        if (summaryBackground !== 'rgba(0, 0, 0, 0)' && summaryBackground !== 'transparent') {
          throw new Error('the tests drawer handle has its own background')
        }
        const footerBackground = getComputedStyle(editorFooter).backgroundColor
        if (footerBackground !== 'rgba(0, 0, 0, 0)' && footerBackground !== 'transparent') {
          throw new Error('editor footer has its own background')
        }
        const editorBounds = editor.getBoundingClientRect()
        if (summaryBounds.top < editorBounds.bottom || summaryBounds.bottom > stageBounds.bottom) {
          throw new Error('the tests drawer is not seated at the bottom of the editor well')
        }
        // Two ends, no centered third item: the hint and the readout hold the rail.
        if (
          footerBounds.top < stageBounds.bottom ||
          Math.abs(shortcutsBounds.left - stageBounds.left) > 1 ||
          Math.abs(cursorBounds.right - stageBounds.right) > 1
        ) {
          throw new Error('the editor footer rail is not a two-ended metadata line')
        }
        if (Math.abs(stageBounds.top - consoleWell.getBoundingClientRect().top) > 1) {
          throw new Error('Editor and Output wells do not share a top edge')
        }
        if (Math.abs(editorHead.getBoundingClientRect().height - outputHead.getBoundingClientRect().height) > 1) {
          throw new Error('Editor and Output headers do not share a height')
        }
        if (
          getComputedStyle(replHead).display !== 'grid' ||
          replShortcuts.getBoundingClientRect().right > replActions.getBoundingClientRect().left ||
          replActions.getBoundingClientRect().left - replShortcuts.getBoundingClientRect().right > 32
        ) {
          throw new Error('REPL metadata and controls do not occupy stable header columns')
        }
        if (Math.abs(wordmark.getBoundingClientRect().top - claim.getBoundingClientRect().top) > 1) {
          throw new Error('the masthead wordmark and its instruction do not share one line')
        }
        if (runBar.getBoundingClientRect().bottom > innerHeight) {
          throw new Error('editor actions are outside the desktop viewport')
        }
        // Results reserve their height up front; the judge run below must not move the REPL.
        window.__demoReplTop = document.querySelector('#repl-history')?.getBoundingClientRect().top
        // The REPL entry ends on the editor well's bottom edge, above the metadata
        // rail: the history well fills the column above it.
        const replEntry = document.querySelector('.repl-entry')
        if (
          !(replEntry instanceof HTMLElement) ||
          Math.abs(replEntry.getBoundingClientRect().bottom - stageBounds.bottom) > 1
        ) {
          throw new Error('the REPL entry is not anchored to the bottom of the editor well')
        }
        // The drawer opens by default, and opening takes height from the source
        // view: the well keeps its size and the list never floats over the code.
        if (!testsDisclosure.open) {
          throw new Error('the tests drawer is not open by default')
        }
        testsDisclosure.open = false
        if (Math.abs(editorStage.getBoundingClientRect().height - stageBounds.height) > 1) {
          throw new Error('closing the tests drawer resized the editor well')
        }
        testsDisclosure.open = true
        const openStageBounds = editorStage.getBoundingClientRect()
        const definitionsBounds = testDefinitions.getBoundingClientRect()
        const openSummaryBounds = testsSummary.getBoundingClientRect()
        if (Math.abs(openStageBounds.height - stageBounds.height) > 1) {
          throw new Error('opening the tests drawer resized the editor well')
        }
        if (
          definitionsBounds.top < openSummaryBounds.bottom - 1 ||
          definitionsBounds.bottom > openStageBounds.bottom + 1 ||
          definitionsBounds.top < editor.getBoundingClientRect().bottom - 1
        ) {
          throw new Error('the open tests drawer does not sit below the source inside the well')
        }
        if (getComputedStyle(testDefinitions).boxShadow !== 'none') {
          throw new Error('the tests drawer is a popover rather than a drawer')
        }
        if (!testDefinitions.textContent?.includes('solve({"name":"runesm"})')) {
          throw new Error('the tests drawer does not list its judge cases')
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
        const tokenColors = new Set([tokenColor('type'), tokenColor('User'), tokenColor("'effect@beta/Schema'")])
        if (tokenColors.has('') || tokenColors.size !== 3) {
          throw new Error('CodeMirror token categories do not have distinct syntax colors')
        }

      })()`)
      await t.browser.evaluate(INSTALL_CODEMIRROR_HELPERS)

      await t.browser.evaluate(`(() => {
        window.__demoHoverCodeMirrorText('#editor', 'User')
      })()`)
      await t.browser.evaluate(`(async () => {
        await window.__demoWaitFor(
          () => document.querySelector('.cm-typescript-info')?.textContent?.includes('Schema.Struct') === true,
          'Effect quick info did not load',
          90,
        )
        if (document.querySelector('.cm-typescript-info')?.textContent?.includes('any') === true) {
          throw new Error('Effect quick info resolved User to any')
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
        const typeTokens = [...document.querySelectorAll('.cm-typescript-info code span')]
        const highlightedTokens = ['const', 'answer', '42'].map((text) =>
          typeTokens.find((token) => token.textContent === text),
        )
        if (highlightedTokens.some((token) => token === undefined)) {
          throw new Error('type hover did not preserve TypeScript display parts')
        }
        const tokenColors = new Set(highlightedTokens.map((token) => getComputedStyle(token).color))
        if (tokenColors.size !== 3) {
          throw new Error('type hover did not syntax-highlight its signature')
        }
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
          return active && source.includes('const User =') && !source.includes('type User =')
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
        if (!source.includes('type User = typeof User.Type')) {
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
      await t.browser.click('#repl-reset')
      await t.browser.reload()
      await t.browser.waitFor(/effect@beta\/Schema/)
      await t.browser.evaluate(`(${INSTALL_CODEMIRROR_HELPERS}, (() => {
        window.__demoPressCodeMirror('#repl-input', 'ArrowRight')
        const suggestedValue = document.querySelector('#repl-input .cm-content')?.textContent
        if (suggestedValue !== "solve({ name: 'repl' })") {
          throw new Error('REPL ArrowRight did not accept the inline suggestion')
        }
        // The recording starts here: the drawer is open by default and stays so on camera.
        if (document.querySelector('.test-drawer')?.open !== true) {
          throw new Error('the tests drawer is closed on the recorded timeline')
        }
        window.__demoSetCodeMirror('#repl-input', '')
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        window.scrollTo(0, 0)
        // Seat the on-camera pointer before the first visible frame.
        void window.__demoMovePointer(innerWidth * 0.62, innerHeight * 0.55, 1)
      })())`)
    })

    // Emit the prepared browser frame on the visible timeline.
    await t.focus('browser')
    await t.sleep('1.2s')
    await t.browser.evaluate(INSTALL_CODEMIRROR_HELPERS)

    // Hover the exact-version npm import: quick info comes from the declaration
    // graph the TypeScript worker acquired for uniku@0.6.0.
    await t.browser.evaluate(`(async () => {
      await window.__demoHoverWithPointer('#editor', 'uuidv7', 4)
    })()`)
    await t.browser.evaluate(`(async () => {
      await window.__demoWaitFor(
        () => document.querySelector('.cm-typescript-info')?.textContent?.includes('uuidv7') === true,
        'uuidv7 quick info did not load',
        90,
      )
      if (document.querySelector('.cm-typescript-info')?.textContent?.includes('any') === true) {
        throw new Error('uuidv7 quick info resolved to any')
      }
      // The well clips its overflow: a tooltip near the top must flip below its token.
      const tooltip = document.querySelector('.cm-typescript-info')?.closest('.cm-tooltip')
      const editorBounds = document.querySelector('#editor')?.getBoundingClientRect()
      if (!(tooltip instanceof HTMLElement) || editorBounds === undefined) {
        throw new Error('uuidv7 quick info tooltip is missing')
      }
      const tooltipBounds = tooltip.getBoundingClientRect()
      if (tooltipBounds.top < editorBounds.top - 1 || tooltipBounds.bottom > editorBounds.bottom + 1) {
        throw new Error('uuidv7 quick info runs outside the editor well and is clipped')
      }
    })()`)
    await t.sleep('1.5s')

    // Hover the User type alias: the Effect schema's decoded shape.
    await t.browser.evaluate(`(async () => {
      await window.__demoHoverWithPointer('#editor', 'User', 11)
    })()`)
    await t.browser.evaluate(`(async () => {
      await window.__demoWaitFor(
        () => document.querySelector('.cm-typescript-info')?.textContent?.includes('type User') === true,
        'User type alias quick info did not load',
        90,
      )
      if (document.querySelector('.cm-typescript-info')?.textContent?.includes('any') === true) {
        throw new Error('User type alias quick info resolved to any')
      }
    })()`)
    await t.sleep('1.5s')

    // Run the two cases against the Effect program in the editor. The pointer
    // leaving the token closes its quick info on the way to the button.
    await t.browser.evaluate(`(async () => {
      await window.__demoClick('#judge')
      await window.__demoWaitFor(
        () => document.querySelector('.cm-typescript-info') === null,
        'quick info stayed open after the pointer left the editor',
      )
    })()`)
    await t.browser.waitFor(/decoded [0-9a-f-]+ for runesm/)
    await t.browser.waitFor(/decoded [0-9a-f-]+ for effect/)
    await t.browser.waitFor(/creates another unique user/)
    await t.browser.evaluate(`(async () => {
      await window.__demoWaitFor(
        () => document.querySelector('.tape-status')?.textContent === 'pass',
        'judge did not report a passing run',
      )
      const uuidV7Pattern = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
      const generatedIds = [...document.querySelectorAll('#console .line')]
        .map((line) => line.textContent?.match(uuidV7Pattern)?.[0])
        .filter((id) => id !== undefined)
      if (generatedIds.length !== 2 || new Set(generatedIds).size !== 2) {
        throw new Error('judge did not produce two unique UUID v7 identifiers')
      }
      const replTop = document.querySelector('#repl-history')?.getBoundingClientRect().top
      if (replTop === undefined || Math.abs(replTop - window.__demoReplTop) > 1) {
        throw new Error('case results shifted the REPL when they arrived')
      }
    })()`)
    await t.sleep('1.5s')

    // Collapse the test cases: the source view takes the drawer's height back.
    await t.browser.evaluate(`(async () => {
      await window.__demoClick('.test-drawer-handle')
      await window.__demoWaitFor(
        () => document.querySelector('.test-drawer')?.open === false,
        'the tests drawer did not collapse',
      )
    })()`)
    await t.sleep('1s')

    // REPL: the editor module seeds the scope, so its solve export is callable.
    await t.browser.evaluate(`(async () => {
      await window.__demoClick('#repl-input .cm-content')
    })()`)
    await t.browser.evaluate(`(() => {
      window.__demoSetCodeMirror('#repl-input', "solve({ name: 'jkomyno' })")
      window.__demoPressCodeMirror('#repl-input', 'Enter')
    })()`)
    await t.browser.waitFor(/decoded [0-9a-f-]+ for jkomyno/)
    await t.browser.waitFor(/= \{"id":"[0-9a-f-]+","name":"jkomyno"\}/)
    await t.sleep('1.5s')

    // ArrowRight on the empty entry accepts the inline suggestion.
    await t.browser.evaluate(`(() => {
      const content = document.querySelector('#repl-input .cm-content')
      if (!(content instanceof HTMLElement)) throw new Error('REPL input is missing')
      content.focus()
      window.__demoPressCodeMirror('#repl-input', 'ArrowRight')
      const suggestedValue = content.textContent
      if (suggestedValue !== "solve({ name: 'repl' })") {
        throw new Error('REPL ArrowRight did not accept the inline suggestion')
      }
    })()`)
    await t.sleep('0.8s')
    await t.browser.evaluate(`(() => {
      window.__demoPressCodeMirror('#repl-input', 'Enter')
    })()`)
    await t.browser.waitFor(/decoded [0-9a-f-]+ for repl/)
    await t.browser.waitFor(/= \{"id":"[0-9a-f-]+","name":"repl"\}/)
    await t.sleep('1.5s')

    // Invalid input: the schema rejects the missing name and the REPL shows the error.
    await t.browser.evaluate(`(() => {
      window.__demoSetCodeMirror('#repl-input', 'solve({ })')
      window.__demoPressCodeMirror('#repl-input', 'Enter')
    })()`)
    await t.browser.evaluate(`(async () => {
      await window.__demoWaitFor(
        () =>
          [...document.querySelectorAll('#repl-history .repl-line-error')].some((line) =>
            line.textContent?.includes('name'),
          ),
        'invalid solve input did not surface its missing name error',
      )
    })()`)
    await t.sleep('1.5s')
  },
)
