import { describe, expect, it } from 'vitest'
import { resolveUpstreamUrl, rewriteRequestModel } from './request'

describe('resolveUpstreamUrl', () => {
  it('uses the configured upstream URL without appending the client path', () => {
    expect(
      resolveUpstreamUrl(
        '/v1/chat/completions?client=value',
        'https://api.example.com/openai/deployments/main/chat/completions?api-version=2025-01-01',
      ),
    ).toBe(
      'https://api.example.com/openai/deployments/main/chat/completions?api-version=2025-01-01',
    )
  })

  it('rejects non-http upstream URLs', () => {
    expect(() => resolveUpstreamUrl('/v1/messages', 'file:///tmp/secret')).toThrow(
      'Unsupported upstream URL protocol',
    )
  })

  it.each([
    ['generateContent', ''],
    ['streamGenerateContent', '?alt=sse'],
  ])('maps Gemini %s requests to the configured upstream model', (action, query) => {
    expect(resolveUpstreamUrl(
      `/v1beta/models/client-model:${action}${query}`,
      'https://generativelanguage.googleapis.com/v1beta/models/configured-model:generateContent?key=value',
      'gemini',
      'gemini-2.5-flash',
    )).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:${action}?key=value${query ? '&alt=sse' : ''}`,
    )
  })
})

describe('rewriteRequestModel', () => {
  it('replaces model while preserving the remaining JSON payload', () => {
    const body = Buffer.from(JSON.stringify({ model: 'client-model', stream: true, messages: [] }))

    const result = JSON.parse(rewriteRequestModel(body, 'provider-model').toString('utf8'))

    expect(result).toEqual({ model: 'provider-model', stream: true, messages: [] })
  })

  it('adds model when the client omitted it', () => {
    const body = Buffer.from(JSON.stringify({ input: 'hello' }))

    const result = JSON.parse(rewriteRequestModel(body, 'embedding-model').toString('utf8'))

    expect(result).toEqual({ input: 'hello', model: 'embedding-model' })
  })

  it('keeps an empty body unchanged', () => {
    expect(rewriteRequestModel(Buffer.alloc(0), 'provider-model')).toEqual(Buffer.alloc(0))
  })

  it('keeps the native Gemini request body unchanged', () => {
    const body = Buffer.from(JSON.stringify({ contents: [{ parts: [{ text: 'hello' }] }] }))

    expect(rewriteRequestModel(body, 'gemini-2.5-flash', 'gemini')).toEqual(body)
  })

  it('rejects malformed or non-object JSON bodies', () => {
    expect(() => rewriteRequestModel(Buffer.from('{'), 'provider-model')).toThrow(
      'Request body must be a JSON object',
    )
    expect(() => rewriteRequestModel(Buffer.from('[]'), 'provider-model')).toThrow(
      'Request body must be a JSON object',
    )
  })
})
