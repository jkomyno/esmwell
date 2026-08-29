import { describe, expect, it } from 'vitest'
import { ReplCommandHistory } from '../../src/repl-command-history'

describe('ReplCommandHistory', () => {
  it('walks backward and forward before restoring the unfinished draft', () => {
    const history = new ReplCommandHistory()
    history.push('const first = 1')
    history.push('first + 1')

    expect(history.previous('sol')).toBe('first + 1')
    expect(history.previous('first + 1')).toBe('const first = 1')
    expect(history.previous('const first = 1')).toBe('const first = 1')
    expect(history.next()).toBe('first + 1')
    expect(history.next()).toBe('sol')
    expect(history.next()).toBeUndefined()
  })

  it('starts a fresh navigation pass after a submitted command', () => {
    const history = new ReplCommandHistory()
    history.push('one()')
    expect(history.previous('draft')).toBe('one()')

    history.push('two()')
    expect(history.previous('next draft')).toBe('two()')
    expect(history.next()).toBe('next draft')
  })
})
