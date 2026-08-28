import { defineVideo } from 'termcut'

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
    })

    await t.sleep('1.2s')

    // Judge: two cases against the Effect program in the editor.
    await t.browser.click('#judge')
    await t.browser.waitFor(/decoded runesm \(age 3\)/)
    await t.browser.waitFor(/decoded effect \(age 4\)/)
    await t.browser.waitFor(/ok in/)
    await t.sleep('1.5s')

    // REPL: the same session keeps declarations alive across inputs.
    await t.browser.evaluate(`(() => {
      window.__demoSubmit = (text) => {
        document.querySelector('#repl-input').value = text
        document.querySelector('#repl-form').requestSubmit()
      }
      window.__demoSubmit("const greet = (name) => 'hi ' + name")
    })()`)
    await t.sleep('900ms')
    await t.browser.evaluate(`(() => window.__demoSubmit("greet('runesm')"))()`)
    await t.browser.waitFor(/'hi runesm'/)
    await t.sleep('1.5s')
  },
)
