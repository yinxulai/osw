import { describe, expect, it } from 'vitest'
import { createAuthHeaders } from '@server/proxy/upstream/auth'

describe('createAuthHeaders', () => {
  it.each(['openai-completions', 'openai-responses'] as const)(
    'uses bearer authorization for %s',
    protocol => {
      expect(createAuthHeaders(protocol, 'secret', null)).toEqual({
        authorization: 'Bearer secret',
      })
    },
  )

  it('uses the Anthropic key and version headers', () => {
    expect(createAuthHeaders('anthropic-messages', 'secret', null)).toEqual({
      'x-api-key': 'secret',
      'anthropic-version': '2023-06-01',
    })
  })

  it('uses an explicitly configured custom header', () => {
    expect(createAuthHeaders('openai-responses', 'secret', 'X-Custom-Key')).toEqual({
      'X-Custom-Key': 'secret',
    })
  })

  it('omits auth headers entirely when the API key is absent (local/test clusters)', () => {
    expect(createAuthHeaders('openai-completions', null, null)).toEqual({})
    expect(createAuthHeaders('openai-responses', null, null)).toEqual({})
  })

  it('keeps the Anthropic version header when the API key is absent', () => {
    expect(createAuthHeaders('anthropic-messages', null, null)).toEqual({
      'anthropic-version': '2023-06-01',
    })
  })
})
