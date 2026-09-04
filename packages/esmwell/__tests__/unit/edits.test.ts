import { quoteString } from 'src/edits'

describe('quoteString', () => {
  it('escapes JavaScript line terminators in generated source', () => {
    const value = "apostrophe'\\line\nfeed\rcarriage\u2028separator\u2029paragraph"

    expect(quoteString(value)).toBe("'apostrophe\\'\\\\line\\nfeed\\rcarriage\\u2028separator\\u2029paragraph'")
  })
})
