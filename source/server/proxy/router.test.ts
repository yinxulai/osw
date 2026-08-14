import { describe, expect, it } from 'vitest'
import { detectProtocolFromPath, findEndpoint } from './router'
import type { UpstreamModel } from '@common/schemas'

describe('findEndpoint', () => {
  const model: UpstreamModel = {
    id: 'model_1',
    logicalModelId: 'model_default',
    providerId: 'prov_1',
    upstreamModelId: 'upstream-1',
    endpoints: [
      { protocol: 'openai-completions', upstreamUrl: 'https://a.example.com', customAuthHeader: null },
      { protocol: 'anthropic-messages', upstreamUrl: 'https://b.example.com', customAuthHeader: 'Bearer x' },
    ],
    priority: 1,
    enabled: true,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  }

  it('returns the endpoint matching the requested protocol', () => {
    expect(findEndpoint(model, 'openai-completions')?.protocol).toBe('openai-completions')
    expect(findEndpoint(model, 'anthropic-messages')?.customAuthHeader).toBe('Bearer x')
  })

  it('returns undefined when the protocol is not configured', () => {
    expect(findEndpoint(model, 'openai-responses')).toBeUndefined()
  })
})

describe('detectProtocolFromPath', () => {
  it.each([
    ['/v1/chat/completions', 'openai-completions'],
    ['/v1/completions', 'openai-completions'],
    ['/v1/embeddings', 'openai-completions'],
    ['/v1/responses?stream=true', 'openai-responses'],
    ['/v1/messages', 'anthropic-messages'],
  ] as const)('detects %s as %s', (path, expected) => {
    expect(detectProtocolFromPath(path)).toBe(expected)
  })

  it.each([
    '/v1/models',
    '/v1/completions/extra',
    '/v1beta/models/gemini-2.5-pro:generateContent',
    '/v1/unknown',
    '/health',
    '/',
  ])('does not claim unsupported path %s', path => {
    expect(detectProtocolFromPath(path)).toBeNull()
  })
})
