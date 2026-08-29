---
name: runesm playground
description: A well-lit workshop bench for running other people's JavaScript in a browser tab.
colors:
  paper: 'oklch(97.5% 0.008 75)'
  paper-sunk: 'oklch(94.5% 0.010 75)'
  paper-raised: 'oklch(99% 0.005 75)'
  rule: 'oklch(86% 0.012 75)'
  rule-strong: 'oklch(62% 0.014 75)'
  graphite: 'oklch(28% 0.014 70)'
  graphite-soft: 'oklch(48% 0.012 70)'
  rust: 'oklch(52% 0.15 45)'
  sap: 'oklch(46% 0.11 150)'
  crimson: 'oklch(47% 0.17 20)'
  ochre: 'oklch(50% 0.115 80)'
  syntax-keyword: 'oklch(37% 0.17 35)'
  syntax-string: 'oklch(36% 0.1 150)'
  syntax-literal: 'oklch(38% 0.13 75)'
  syntax-type: 'oklch(38% 0.13 280)'
  syntax-function: 'oklch(36% 0.13 320)'
  syntax-variable: 'oklch(36% 0.09 235)'
  syntax-property: 'oklch(38% 0.08 215)'
  syntax-comment: 'oklch(45% 0.03 75)'
  syntax-punctuation: 'oklch(42% 0.015 75)'
  editor-selection: 'oklch(82% 0.07 75)'
  editor-selection-match: 'oklch(88% 0.035 75)'
  editor-active-line: 'oklch(91% 0.014 75)'
typography:
  display:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif'
    fontSize: 'clamp(2rem, 1.4rem + 2.6vw, 3.25rem)'
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: '-0.02em'
  headline:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: '-0.01em'
  title:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.1875rem'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 'normal'
  body:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
  label:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '0.08em'
  code:
    fontFamily: 'Martian Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: 'normal'
    fontVariation: "'wdth' 87.5"
rounded:
  sm: '2px'
  md: '4px'
  pill: '999px'
spacing:
  hair: '4px'
  tight: '8px'
  snug: '12px'
  base: '20px'
  loose: '32px'
  wide: '52px'
components:
  button-primary:
    backgroundColor: '{colors.graphite}'
    textColor: '{colors.paper}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '10px 20px'
  button-primary-hover:
    backgroundColor: '{colors.rust}'
    textColor: '{colors.paper}'
  button-secondary:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.graphite}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '10px 20px'
  well-code:
    backgroundColor: '{colors.paper-sunk}'
    textColor: '{colors.graphite}'
    typography: '{typography.code}'
    rounded: '{rounded.md}'
    padding: '12px'
  source-language-controls:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.graphite}'
    typography: '{typography.code}'
    rounded: '{rounded.sm}'
    padding: '4px 10px'
  test-disclosure:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.graphite}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '6px 10px'
  case-row:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.graphite}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
---

# Design System: runesm playground

## 1. Overview

**Creative North Star: "The Well-Lit Bench"**

A workshop bench under good daylight, with labeled drawers and nothing hidden behind a cover plate. The visitor is a builder deciding whether runesm fits their product, and the fastest way to convince them is to hand them the tool and let them watch it work. Every surface is meant to be picked up and changed. Nothing is a display case.

The system takes its precision from Rams-era Braun product documentation: a machine explained without ornament, where every part is labeled in the same quiet voice and the labels are the design. It takes its warmth from paper rather than from decoration. The ground is a warm off-white at `oklch(97.5% 0.008 75)`, not white, and the ink is a warm near-black at `oklch(28% 0.014 70)`, not black. Every neutral is tinted toward the same warm hue so the interface reads as a printed sheet under a lamp rather than as a screen.

This explicitly rejects what a developer tool is expected to look like. Not near-black plus one blue accent. Not uniform rounded cards. Not a reflex-default sans. It equally rejects the two anti-references named in PRODUCT.md: no gradient meshes, glassmorphism, floating 3D blobs, purple-to-pink palettes or oversized rounded corners; and no CRT glow, scanlines, blinking block cursors, ASCII art or green-on-black. Only part of this interface is a terminal, and dressing the rest as one would be a lie about what runesm is.

Color here is information, never decoration. UI state has four semantic hues with one job each. The editor has a separate, scoped syntax-ink palette so language structure is visible without borrowing status meaning.

**Key Characteristics:**

- Warm paper ground, warm ink, warm neutrals: no pure white, no pure black, everything tinted toward hue 75
- Four UI-state hues with one job each, plus an editor-only syntax palette
- Near-square corners (2–4px). Roundness is not a personality here
- Flat by default. Depth comes from recessing what the machine writes into, not from shadows
- Labeled panes as the organizing grammar, in the manner of equipment documentation
- Motion is feedback only: it exists to make streaming legible, never to decorate

## 2. Colors

Warm paper and warm ink, with four saturated UI hues held in reserve for interface state. A separate syntax palette appears only inside the editor. Every text value below is contrast-verified against its ground.

### Primary

- **Rust** (`oklch(52% 0.15 45)` / `#ab4400`): the brand hue and the only accent. Links, focus rings, and the hover state of the primary action. 5.46:1 on paper, 4.99:1 on wells. It is deliberately _not_ the action color; see the Ink Acts Rule.

### Secondary

- **Sap** (`oklch(46% 0.11 150)` / `#1d6835`): a passing case, and the REPL prompt caret. 6.29:1 on paper, 5.76:1 on wells.
- **Crimson** (`oklch(47% 0.17 20)` / `#a51c30`): a failing case, a thrown error, an unresolvable import. 6.95:1 on paper, 6.36:1 on wells.
- **Ochre** (`oklch(50% 0.115 80)` / `#855a00`): a run in flight, a warning, a pending resolution. 5.65:1 on paper, 5.17:1 on wells.

### Neutral

- **Paper** (`oklch(97.5% 0.008 75)` / `#faf6f1`): the page ground. A warm off-white sheet.
- **Paper Sunk** (`oklch(94.5% 0.010 75)` / `#f1ece6`): every surface the machine writes into. The editor, the console, the REPL history.
- **Paper Raised** (`oklch(99% 0.005 75)` / `#fefbf8`): controls sitting on top of a sunk well, such as the language switch, restore control, and REPL entry.
- **Graphite** (`oklch(28% 0.014 70)` / `#2d2821`): body text, code, and the primary action fill. 13.59:1 on paper.
- **Graphite Soft** (`oklch(48% 0.012 70)` / `#625d56`): pane labels, hints, secondary metadata. 6.09:1 on paper, 5.57:1 on wells.
- **Rule** (`oklch(86% 0.012 75)` / `#d6d0c9`): decorative hairlines and dividers only, where the boundary is not needed to identify a control.
- **Rule Strong** (`oklch(62% 0.014 75)` / `#8b857d`): the boundary of any interactive control. 3.39:1 on paper, 3.10:1 on wells, clearing WCAG 1.4.11 for non-text contrast.

### Syntax Ink

- **Keyword** (`oklch(37% 0.17 35)`): module and language keywords. 9.14:1 on wells.
- **String** (`oklch(36% 0.1 150)`): strings and template content. 8.84:1 on wells.
- **Literal** (`oklch(38% 0.13 75)`): numbers, booleans, null, and regexp literals. 8.65:1 on wells.
- **Type** (`oklch(38% 0.13 280)`): type names, classes, and namespaces. 8.89:1 on wells.
- **Function** (`oklch(36% 0.13 320)`): function and method names. 9.87:1 on wells.
- **Variable** (`oklch(36% 0.09 235)`): definitions and local names. 8.97:1 on wells.
- **Property** (`oklch(38% 0.08 215)`): property and attribute names. 8.13:1 on wells.
- **Comment** (`oklch(45% 0.03 75)`): comments, also italicized. 6.35:1 on wells.
- **Punctuation** (`oklch(42% 0.015 75)`): operators, delimiters, and other syntax marks. 7.21:1 on wells.

Editor selection uses a solid ochre-tinted ground (`oklch(82% 0.07 75)`) while retaining token ink. Matching selections use `oklch(88% 0.035 75)` and the active line uses `oklch(91% 0.014 75)`, so highlighting never makes source text disappear.

Syntax ink is meaningful only inside source code. It never appears in headings, controls, status labels, output, or panel chrome.

### Named Rules

**The Four UI Jobs Rule.** There are exactly four semantic UI hues, and each has exactly one job: rust for the brand and its links, sap for pass, crimson for fail, ochre for running. Syntax ink is confined to editor tokens and never carries UI state. Another hue in headings, icons, panel chrome, status, or hover backgrounds is prohibited.

**The Ink Acts Rule.** The primary action is graphite fill with paper text, not a colored button. Actions are the darkest thing on the page because weight, not hue, is what makes them primary. This also keeps rust and crimson from ever having to be told apart at a glance.

**The Never Hue-Alone Rule.** Status is never carried by color alone. Every pass, fail, running, and error state ships a text label or glyph alongside its hue. Removing all color from the interface must leave it fully readable.

**The Two-Ground Rule.** Only two background values appear in normal use: paper and paper-sunk. A third background is a sign that a container was added that did not need to exist.

## 3. Typography

**Display Font:** Archivo (with `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** Archivo (same family, lighter weights)
**Label/Mono Font:** Martian Mono (with `ui-monospace, SFMono-Regular, Menlo, monospace`)

**Character:** Archivo is a sturdy grotesque drawn for signage and highway lettering: it holds up at label size, has real weight range for hierarchy, and carries none of the softness that would make this read as a consumer app. Martian Mono is wide, slabby and unmistakably machine, set at `wdth 87.5` so it stays dense enough for a code editor. Together they read as equipment properly labeled, which is exactly the Braun-manual reference. Both are variable fonts with width and weight axes.

### Hierarchy

- **Display** (700, `clamp(2rem, 1.4rem + 2.6vw, 3.25rem)`, 1.05, `-0.02em`): the playground wordmark and nothing else.
- **Headline** (650, 1.5rem, 1.15, `-0.01em`): section headings when the page grows past one screen.
- **Title** (600, 1.1875rem, 1.25): pane titles that need more presence than a label.
- **Body** (400, 0.9375rem, 1.6): prose, hints, case names. Capped at 65–75ch wherever it runs long.
- **Label** (600, 0.75rem, 1.2, `0.08em`, uppercase): pane labels and button text.
- **Code** (400, 0.8125rem, 1.65, `wdth 87.5`): editor contents, console output, REPL history, and test invocations.

Steps are 0.75 → 0.9375 → 1.1875 → 1.5, each at least 1.25× the last. Flat scales are prohibited.

### Named Rules

**The Labeled Drawer Rule.** Every pane carries a small uppercase Archivo label in graphite-soft: EDITOR, OUTPUT, REPL. This is the deliberate organizing grammar of the system, taken from equipment documentation, and it is the one place repeated uppercase tracked labels are correct. Do not extend the pattern to decorative kickers above ordinary headings.

**The Mono Is For Code Rule.** Martian Mono appears only where the content is code or machine output. Chrome, labels, buttons, hints and prose are Archivo. Monospace used as a costume for "developer tool" is prohibited; this interface has real code in it and that is the only reason mono is here.

## 4. Elevation

Flat by default. There are no decorative shadows anywhere in this system, and no glass, blur, or translucency. Depth is tonal and it means one specific thing: recession indicates a surface the machine writes into, rather than a surface the user acts on.

The editor, the console, the REPL history, and the expanded test list are recessed to `paper-sunk`. Buttons and the REPL entry field sit flush on `paper` or raised to `paper-raised`. That is the entire depth vocabulary.

One shadow exists, and only for elements that genuinely float above the page:

### Shadow Vocabulary

- **Lifted** (`box-shadow: 0 6px 20px -8px oklch(28% 0.014 70 / 0.22)`): reserved for elements detached from the document flow, such as a dropdown or popover. Not for cards, panes, buttons, or wells.

### Named Rules

**The Sunk Well Rule.** Anything the machine writes into is recessed. Anything the user acts on is flush or raised. If a surface is recessed and the user is expected to type into it, it is an editor, and that is correct; if a surface is recessed and purely decorative, delete the container.

**The No Ambient Shadow Rule.** A shadow on a resting element is prohibited. If an element needs separation, use the ground change or a `rule` hairline, not elevation.

## 5. Components

### Buttons

- **Shape:** near-square (2px radius). Roundness is not doing expressive work here.
- **Primary:** graphite fill, paper text, label typography, 10px/20px padding. The darkest element on the page.
- **Secondary:** paper-raised fill, graphite text, 1px `rule-strong` border, same padding and typography.
- **Hover / Focus:** primary shifts fill from graphite to rust over 120ms. Focus-visible is a 2px rust outline at 2px offset on every control, never a removed outline.
- **Disabled:** graphite-soft text on paper-sunk, no border change, `cursor: not-allowed`. Used while a run is in flight.

### Security Qualifier

- **Placement:** directly below the masthead claim, where the word "sandbox" first appears.
- **Style:** label-size Archivo in graphite-soft, on the page ground with no container or icon.
- **Content:** distinguish hang isolation from hostile-code containment and link to the full security model.

### Cards / Containers

There are no cards in this system. Panes are defined by a label and a ground change, not by a bordered box, and nested containers are prohibited. When a boundary is genuinely needed, it is a single 1px `rule` hairline.

### Wells

- **Style:** paper-sunk fill, 4px radius, 12px padding, code typography, no border.
- **Behavior:** scroll internally rather than growing the page. The console well is a polite live region so streamed output is announced.
- **Editor syntax:** CodeMirror 6 owns editing, keyboard navigation, completion, diagnostics, inferred-type hover help, and syntax rendering. Its dedicated TypeScript worker acquires and caches npm declaration graphs on demand for bare imports and their inline versions. `.ts` compiles in that worker before runesm executes the emitted module; `.mjs` shows the generated JavaScript and passes it directly to runesm. TypeScript edits invalidate the generated view. Invalid TypeScript stays in `.ts`. Direct JavaScript edits disable `.ts` until restore resets both views. Token ink and selection grounds use the scoped editor palette; UI semantic hues do not color syntax.
- **Empty state:** a single line of graphite-soft body text stating what will appear here, never a blank box.

### Source Language Controls

- **Structure:** an icon-only restore control followed by the connected `.ts` and `.mjs` selector. Every icon control has an accessible name and native disabled state.
- **State:** `.mjs` is unavailable only while TypeScript compilation is failing. `.ts` becomes unavailable after direct JavaScript edits. A visible status line explains either block.
- **Restore:** the restore control returns to the initial TypeScript source, invalidates cached JavaScript, re-enables both languages, and resets the REPL scope.

### Test Disclosure

- **Structure:** native `details` and `summary` in a dedicated bottom-right strip inside the editor well, closed by default. The strip keeps the control clear of editable text. The summary reads `View tests`; its list opens above it so the control stays in place.
- **Content:** every judge case shows its name, exact exported-function invocation, and expectation before execution.
- **Style:** the summary is a compact raised control. The expanded list is a genuine popover using `paper-sunk`, the lifted shadow, one hairline between rows, body text for names and expectations, and code typography for invocations.

### Case Result Row

The signature component, and the one place the old design broke a hard rule.

- **Structure:** case name (body) on the left, status word (label, uppercase) on the right, optional detail line beneath in graphite-soft.
- **Status:** the status _word_ is colored, sap for PASS, crimson for FAIL, ochre for ERROR. The row itself carries a full 1px `rule` border and paper ground.
- **Prohibited:** a colored `border-left` stripe. This is a hard ban and the previous implementation used a 3px left border as the entire status signal. Status lives in the word.

### REPL Entry

- **Style:** paper-raised, 1px `rule-strong` border, 2px radius, with a sap `›` caret and a borderless CodeMirror entry that inherits code typography.
- **Scope:** the current editor module evaluates as the first input. Later declarations persist until reset, source edits, language changes, or source restore rebuilds the scope.
- **Input:** `Ctrl+Space` opens completion against the editor module and successful prior inputs. Right arrow accepts the faded inline suggestion while the input is empty. Up and down arrows traverse command history, restoring the unfinished draft after the newest entry.
- **History:** a sunk well above it. Input lines prefixed `›` in graphite, values prefixed `=` in graphite-soft, errors prefixed `!` in crimson.

## 6. Do's and Don'ts

### Do:

- **Do** tint every neutral toward hue 75. Warm paper (`#faf6f1`) and warm ink (`#2d2821`), never `#fff` or `#000`.
- **Do** keep the four UI hues to their four jobs: rust brand, sap pass, crimson fail, ochre running. Keep syntax ink inside editor source.
- **Do** make the primary action graphite fill with paper text. Weight makes it primary, not color.
- **Do** pair every status color with a text label, so the interface survives with all color removed.
- **Do** recess surfaces the machine writes into, and keep surfaces the user acts on flush or raised.
- **Do** use Martian Mono only for code and machine output. Everything else is Archivo.
- **Do** vary spacing for rhythm across the 4/8/12/20/32/52 scale. Identical padding on every element is monotony.
- **Do** honor `prefers-reduced-motion` on every transition, and keep motion to feedback that makes streaming legible.
- **Do** give every control a visible 2px rust focus ring at 2px offset.
- **Do** use `rule-strong` (3.39:1) for any boundary that identifies a control, and `rule` only for decorative hairlines.

### Don't:

- **Don't** use a `border-left` or `border-right` greater than 1px as a colored accent stripe. The case rows previously did exactly this; it is banned outright.
- **Don't** reach for gradient mesh backgrounds, glassmorphism, floating 3D blobs, purple-to-pink palettes, or oversized rounded corners. This is the "playful AI-startup" anti-reference from PRODUCT.md.
- **Don't** add CRT glow, scanlines, blinking block cursors, ASCII art, or green-on-black. This is the "terminal cosplay" anti-reference from PRODUCT.md, and it is dishonest when only part of this interface is a terminal.
- **Don't** fall back to near-black plus one blue accent, uniform rounded cards, and a reflex-default sans. That is the category reflex PRODUCT.md names, and it is what this interface looked like before.
- **Don't** use `background-clip: text` with a gradient. Emphasis comes from weight and size.
- **Don't** wrap panes in bordered cards, and never nest a container inside a container.
- **Don't** add a shadow to a resting element. If it looks like a 2014 app, the shadow should not be there at all.
- **Don't** introduce another UI hue, use syntax ink outside source code, or color a heading, icon, or panel chrome.
- **Don't** set body text wider than 75ch.
- **Don't** animate layout properties. Transition color, opacity, and transform only, with ease-out curves and no bounce.
