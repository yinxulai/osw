import { describe, expect, it } from 'vitest'
import { formatContent } from './format-content'

describe('formatContent', () => {
  it('restores line breaks in captured streaming chunks', () => {
    const value = JSON.stringify({
      schemaVersion: 1,
      chunks: ['event: message\ndata: {"text":"hello"}\n\n', 'data: [DONE]\n\n'],
    })

    expect(formatContent(value)).toEqual({
      value: 'event: message\ndata: {"text":"hello"}\n\ndata: [DONE]\n\n',
      isJson: true,
    })
  })

  it('keeps regular JSON formatted and does not alter escaped content', () => {
    const value = JSON.stringify({ message: 'literal \\n text' })

    expect(formatContent(value)).toEqual({
      value: '{\n  "message": "literal \\\\n text"\n}',
      isJson: true,
    })
  })

  it('returns non-JSON content unchanged', () => {
    expect(formatContent('plain response')).toEqual({ value: 'plain response', isJson: false })
  })
})
