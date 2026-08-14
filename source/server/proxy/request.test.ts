import { describe, expect, it } from 'vitest'
import {
  resolveUpstreamUrl,
  resolveEffectiveUpstreamUrl,
  rewriteRequestModel,
} from './request'

describe('resolveUpstreamUrl', () => {
  it('uses the configured upstream URL without appending the client path', () => {
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

describe('resolveEffectiveUpstreamUrl', () => {
  it('prefers the model endpoint URL when it is set', () => {
    expect(
      resolveEffectiveUpstreamUrl(
        'https://model.example.com/v1/chat/completions',
        '{"openai-completions":"https://provider.example.com/v1/chat/completions"}',
        'openai-completions',
      ),
    ).toBe('https://model.example.com/v1/chat/completions')
  })

  it('falls back to the provider-level URL for the protocol when model endpoint URL is empty', () => {
    expect(
      resolveEffectiveUpstreamUrl(
        '',
        '{"openai-completions":"https://ark.cn-beijing.volces.com/api/v3/chat/completions"}',
        'openai-completions',
      ),
    ).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions')
  })

  it('trims surrounding whitespace from the resolved URL', () => {
    expect(
      resolveEffectiveUpstreamUrl(
        '  ',
        '{"anthropic-messages":"  https://api.anthropic.com/v1/messages  "}',
        'anthropic-messages',
      ),
    ).toBe('https://api.anthropic.com/v1/messages')
  })

  it('throws when neither model endpoint URL nor provider default exists for the protocol', () => {
    expect(() =>
      resolveEffectiveUpstreamUrl('', '{}', 'openai-responses'),
    ).toThrow('未配置上游地址')
  })

  it('throws when the provider upstreamUrls JSON is malformed', () => {
    expect(() =>
      resolveEffectiveUpstreamUrl('', 'not-json', 'openai-completions'),
    ).toThrow('未配置上游地址')
  })

  it('throws when the provider upstreamUrls is null or undefined', () => {
    expect(() => resolveEffectiveUpstreamUrl('', null, 'openai-completions')).toThrow(
      '未配置上游地址',
    )
    expect(() => resolveEffectiveUpstreamUrl('', undefined, 'openai-completions')).toThrow(
      '未配置上游地址',
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
