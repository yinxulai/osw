import { describe, expect, it } from 'vitest'
import { extractRequestIdFromBody, extractRequestIdFromSse } from './execution/attempt-executor'

describe('upstream request id extraction', () => {
  it('extracts a top-level request id from JSON', () => {
    expect(extractRequestIdFromBody('{"id":"req-upstream-123"}')).toBe('req-upstream-123')
    expect(extractRequestIdFromBody('{"request_id":"req-upstream-456"}')).toBe('req-upstream-456')
    expect(extractRequestIdFromBody('{"requestId":"req-upstream-789"}')).toBe('req-upstream-789')
  })

  it('extracts a nested request id from provider error JSON', () => {
    expect(extractRequestIdFromBody(JSON.stringify({
      error: { metadata: { request_id: 'req-nested-123' } },
    }))).toBe('req-nested-123')
  })

  it('extracts a request id from SSE data events', () => {
    const body = 'event: response\ndata: {"response":{"id":"resp-sse-123"}}\n\ndata: [DONE]\n\n'
    expect(extractRequestIdFromSse(body)).toBe('resp-sse-123')
    expect(extractRequestIdFromBody(body)).toBe('resp-sse-123')
  })

  it('extracts a request id from captured streaming chunks', () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      chunks: ['data: {"id":"chatcmpl-sse-123"}\n\n', 'data: [DONE]\n\n'],
    })
    expect(extractRequestIdFromBody(body)).toBe('chatcmpl-sse-123')
  })

  it('ignores missing, blank, malformed, and done-only responses', () => {
    expect(extractRequestIdFromBody(null)).toBeNull()
    expect(extractRequestIdFromBody('')).toBeNull()
    expect(extractRequestIdFromBody('{"id":"   "}')).toBeNull()
    expect(extractRequestIdFromBody('{not-json}')).toBeNull()
    expect(extractRequestIdFromSse('data: [DONE]\n\n')).toBeNull()
  })
})
