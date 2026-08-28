import { describe, expect, it } from 'vitest'
import {
  resolveUpstreamUrl,
  rewriteRequestModel,
} from '@server/proxy/request/request'

describe('resolveUpstreamUrl', () => {
  it('uses the configured Provider endpoint URL without appending the client path', () => {
    expect(
      resolveUpstreamUrl(
        'https://api.example.com/openai/deployments/main/chat/completions?api-version=2025-01-01',
      ),
    ).toBe(
      'https://api.example.com/openai/deployments/main/chat/completions?api-version=2025-01-01',
    )
  })

  it('rejects non-http upstream URLs', () => {
    expect(() => resolveUpstreamUrl('file:///tmp/secret')).toThrow(
      'Unsupported upstream URL protocol',
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

  it('rejects malformed or non-object JSON bodies', () => {
    expect(() => rewriteRequestModel(Buffer.from('{'), 'provider-model')).toThrow(
      'Request body must be a JSON object',
    )
    expect(() => rewriteRequestModel(Buffer.from('[]'), 'provider-model')).toThrow(
      'Request body must be a JSON object',
    )
  })
})
