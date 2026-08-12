import { describe, expect, it } from 'vitest'
import { detectProtocolFromPath } from './router'

describe('detectProtocolFromPath', () => {
  it.each([
    ['/v1/completions', 'openai-completions'],
    ['/v1/responses?stream=true', 'openai-responses'],
    ['/v1/messages', 'anthropic-messages'],
  ] as const)('detects %s as %s', (path, expected) => {
    expect(detectProtocolFromPath(path)).toBe(expected)
  })

  it.each([
    '/v1/models',
    '/v1/chat/completions',
    '/v1/embeddings',
    '/v1beta/models/gemini-2.5-pro:generateContent',
    '/v1/unknown',
    '/health',
    '/',
  ])('does not claim unsupported path %s', path => {
    expect(detectProtocolFromPath(path)).toBeNull()
  })
})
