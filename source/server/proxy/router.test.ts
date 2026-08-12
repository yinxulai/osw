import { describe, expect, it } from 'vitest'
import { detectProtocolFromPath } from './router'

describe('detectProtocolFromPath', () => {
  it.each([
    ['/v1/chat/completions', 'openai'],
    ['/v1/completions', 'openai'],
    ['/v1/embeddings', 'openai'],
    ['/v1/messages', 'anthropic'],
    ['/v1beta/models/gemini-2.5-pro:generateContent', 'gemini'],
    ['/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', 'gemini'],
  ] as const)('detects %s as %s', (path, expected) => {
    expect(detectProtocolFromPath(path)).toBe(expected)
  })

  it.each([
    '/v1/models',
    '/v1/unknown',
    '/health',
    '/',
  ])('does not claim unsupported path %s', path => {
    expect(detectProtocolFromPath(path)).toBeNull()
  })
})
