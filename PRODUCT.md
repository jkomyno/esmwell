# Product

## Register

brand

## Users

Developers building something that needs to run other people's JavaScript: coding-education platforms, technical interview tools, interactive documentation, in-browser exercise runners.

They arrive from the npm page, the README, or a future docs site, mid-evaluation. They are not skeptical that esmwell exists; they are deciding whether it fits the thing they are building. The question in their head is "can this do my use case, and what will it cost me to find out?"

The job to be done: understand judge mode, REPL mode, and test-workspace mode well enough to decide within a few minutes, without reading the full API reference first.

## Product Purpose

The playground is the argument for esmwell. It is the one surface where the library's claims stop being prose and become something the reader operates: bare imports resolving from esm.sh with no bundler, console output streaming while code is still running, an infinite loop returning a typed timeout instead of freezing the tab, and a REPL scope that survives across inputs. Its `.ts` mode is an authoring convenience that compiles in the browser before esmwell receives ESM; `.mjs` exposes the library's direct JavaScript boundary.

It serves three surfaces at once, and the design has to hold up in all three:

- a public playground people land on cold
- the source of the GIF and screenshots embedded in the README and on npm, where it is seen as a still image far more often than it is visited
- future embedded live examples inside docs pages

Success is a builder leaving with an accurate model of what esmwell does and does not do, having formed it by using the thing rather than by being told.

Known gap: test-workspace mode (Vitest/Jest over a virtual project) is a headline capability with no representation in the playground today. Only judge and REPL are demonstrated.

## Brand Personality

A workshop bench. Warm, hands-on, generous.

Everything on the surface is meant to be picked up and changed, not admired. The tone is a knowledgeable person showing you how something works and handing you the tool, with labeled drawers and nothing hidden. Forgiving of mistakes, because mistakes are how you learn the shape of a tool.

Three words: **warm, hands-on, generous**.

Emotional goal: the confidence that comes from having actually run something, not from having read a claim about it.

## Anti-references

- **Playful AI-startup.** Gradient mesh backgrounds, glassmorphism, floating 3D blobs, purple-to-pink palettes, oversized rounded corners. Undermines the credibility the playground exists to build.
- **Terminal cosplay.** Fake CRT glow, scanlines, blinking block cursors, ASCII art, green-on-black. Costume rather than voice, and dishonest here: only part of this interface is a terminal.
- **Category reflex.** "Developer tool" must not automatically produce near-black plus one blue accent, uniform rounded cards, and a reflex-default sans. That is what the playground looks like today and it is the first thing any generator reaches for on this brief. The warmth of the workshop-bench personality should be doing real work against it.

## Design Principles

1. **Show the machine, don't describe it.** The pitch is execution you can watch: dependencies resolving, console lines arriving mid-run, a worker dying and recovering. Prefer demonstrating a claim over stating it in copy.
2. **A bench, not a display case.** Everything is editable by default and safe to break. No read-only showcase panels, no "look but don't touch" regions.
3. **Failure is the feature.** A failing case, a timeout, an unresolvable import are the product working correctly. Render them as informative outcomes with enough detail to act on, never as apologetic error states.
4. **Fit assessment in one screen.** The reader is deciding whether this covers their use case. What esmwell does, and where its boundaries are, must be legible without scrolling through prose or leaving for the API docs.
5. **Practice what you preach.** The playground ships under the same constraints it demonstrates: ESM only, no bundler magic in the execution path, real browser, real workers. Nothing in the demo is simulated.

## Accessibility & Inclusion

WCAG 2.2 AA.

- AA contrast throughout, including code surfaces and the pass/fail/error result states. Result status must never be carried by color alone.
- Full keyboard operability, with visible focus on every interactive element. The editor, language and restore controls, test disclosure, run controls, and REPL entry form all sit on the main path.
- `prefers-reduced-motion` honored for any streaming, entrance, or state-change motion.
- Run results and streamed console output are announced to screen readers via appropriate live regions, since the interface updates asynchronously after a user action.
