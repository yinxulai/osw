import { describe, expect, it } from 'vitest'
import { createAuthHeaders } from './auth'

describe('createAuthHeaders', () => {
  it('uses bearer authorization for OpenAI', () => {
    expect(createAuthHeaders('openai', 'secret', null)).toEqual({
      authorization: 'Bearer secret',
    })
  })

  it('uses the Anthropic key and version headers', () => {
    expect(createAuthHeaders('anthropic', 'secret', null)).toEqual({
      'x-api-key': 'secret',
      'anthropic-version': '2023-06-01',
    })
  })

  it('uses the Google API key header for Gemini', () => {
    expect(createAuthHeaders('gemini', 'secret', null)).toEqual({
      'x-goog-api-key': 'secret',
    })
  })

  it('uses an explicitly configured custom header', () => {
    expect(createAuthHeaders('openai', 'secret', 'X-Custom-Key')).toEqual({
      'X-Custom-Key': 'secret',
    })
  })
})
