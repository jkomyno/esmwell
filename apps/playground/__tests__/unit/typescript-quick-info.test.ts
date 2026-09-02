import { describe, expect, it } from 'vitest'
import * as ts from 'typescript-legacy'
import { serializeQuickInfo } from '../../src/typescript-quick-info'

describe('serializeQuickInfo', () => {
  it('preserves display-part kinds for syntax-highlighted hover signatures', () => {
    expect(
      serializeQuickInfo({
        kind: ts.ScriptElementKind.constElement,
        kindModifiers: '',
        textSpan: { start: 6, length: 6 },
        displayParts: [
          { kind: 'keyword', text: 'const' },
          { kind: 'space', text: ' ' },
          { kind: 'localName', text: 'answer' },
          { kind: 'punctuation', text: ':' },
          { kind: 'space', text: ' ' },
          { kind: 'stringLiteral', text: '42' },
        ],
        documentation: [{ kind: 'text', text: 'The inferred answer.' }],
      }),
    ).toEqual({
      from: 6,
      to: 12,
      displayParts: [
        { kind: 'keyword', text: 'const' },
        { kind: 'space', text: ' ' },
        { kind: 'localName', text: 'answer' },
        { kind: 'punctuation', text: ':' },
        { kind: 'space', text: ' ' },
        { kind: 'stringLiteral', text: '42' },
      ],
      documentation: 'The inferred answer.',
    })
  })

  it('returns null when TypeScript has no information at the hovered position', () => {
    expect(serializeQuickInfo(undefined)).toBeNull()
  })
})
