export class ReplCommandHistory {
  readonly #entries: string[] = []
  #index = 0
  #draft = ''

  push(command: string): void {
    if (command !== '') {
      this.#entries.push(command)
    }
    this.#index = this.#entries.length
    this.#draft = ''
  }

  previous(current: string): string | undefined {
    if (this.#entries.length === 0) {
      return undefined
    }
    if (this.#index === this.#entries.length) {
      this.#draft = current
    }
    this.#index = Math.max(0, this.#index - 1)
    return this.#entries[this.#index]
  }

  next(): string | undefined {
    if (this.#index === this.#entries.length) {
      return undefined
    }
    this.#index += 1
    return this.#index === this.#entries.length ? this.#draft : this.#entries[this.#index]
  }
}
