import type { SourceLanguage } from './typescript-protocol'

type SourceState =
  | {
      readonly kind: 'typescript'
      readonly typescript: string
      readonly javascript?: string
    }
  | {
      readonly kind: 'javascript-derived'
      readonly typescript: string
      readonly javascript: string
    }
  | {
      readonly kind: 'javascript-edited'
      readonly javascript: string
    }

export type JavaScriptTransitionResult =
  | { readonly status: 'shown' }
  | { readonly status: 'source-changed' }
  | { readonly status: 'failed'; readonly error: unknown }

export class SourceLanguageState {
  readonly #initialTypeScript: string
  #state: SourceState

  constructor(initialTypeScript: string) {
    this.#initialTypeScript = initialTypeScript
    this.#state = { kind: 'typescript', typescript: initialTypeScript }
  }

  get language(): SourceLanguage {
    return this.#state.kind === 'typescript' ? 'ts' : 'mjs'
  }

  get source(): string {
    return this.#state.kind === 'typescript' ? this.#state.typescript : this.#state.javascript
  }

  get dirty(): boolean {
    if (this.#state.kind === 'javascript-edited') {
      return true
    }
    return this.#state.typescript !== this.#initialTypeScript
  }

  get typeScriptAvailable(): boolean {
    return this.#state.kind !== 'javascript-edited'
  }

  edit(source: string): void {
    if (this.#state.kind === 'typescript') {
      this.#state = { kind: 'typescript', typescript: source }
      return
    }
    this.#state = { kind: 'javascript-edited', javascript: source }
  }

  javascriptForCurrentTypeScript(): string | undefined {
    return this.#state.kind === 'typescript' ? this.#state.javascript : undefined
  }

  async showJavaScriptForCurrentTypeScript(
    transpile: (source: string) => Promise<string>,
  ): Promise<JavaScriptTransitionResult> {
    if (this.#state.kind !== 'typescript') {
      return { status: 'source-changed' }
    }
    const typescript = this.#state.typescript
    let javascript = this.#state.javascript
    if (javascript === undefined) {
      try {
        javascript = await transpile(typescript)
      } catch (error) {
        return this.#isCurrentTypeScript(typescript) ? { status: 'failed', error } : { status: 'source-changed' }
      }
    }
    if (!this.#isCurrentTypeScript(typescript)) {
      return { status: 'source-changed' }
    }
    this.showJavaScript(javascript)
    return { status: 'shown' }
  }

  showJavaScript(javascript: string): void {
    if (this.#state.kind !== 'typescript') {
      throw new Error('JavaScript can only be derived from the visible TypeScript source')
    }
    this.#state = {
      kind: 'javascript-derived',
      typescript: this.#state.typescript,
      javascript,
    }
  }

  showTypeScript(): boolean {
    if (this.#state.kind === 'javascript-edited') {
      return false
    }
    if (this.#state.kind === 'javascript-derived') {
      this.#state = {
        kind: 'typescript',
        typescript: this.#state.typescript,
        javascript: this.#state.javascript,
      }
    }
    return true
  }

  reset(): void {
    this.#state = { kind: 'typescript', typescript: this.#initialTypeScript }
  }

  #isCurrentTypeScript(source: string): boolean {
    return this.#state.kind === 'typescript' && this.#state.typescript === source
  }
}
