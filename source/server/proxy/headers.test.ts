import { describe, expect, it } from 'vitest'
import { createDownstreamHeaders, createUpstreamHeaders } from './headers'

describe('proxy headers', () => {
  it('preserves end-to-end request headers and replaces authentication', () => {
    const result = createUpstreamHeaders({
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-goog-user-project': 'billing-project',
      'x-goog-api-client': 'genai-js/1.0',
      authorization: 'Bearer client-token',
      'x-goog-api-key': 'client-key',
      connection: 'keep-alive, x-remove-me',
      'x-remove-me': 'private',
      'transfer-encoding': 'chunked',
    }, { 'x-goog-api-key': 'provider-key' }, 42)

    expect(result).toEqual({
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-goog-user-project': 'billing-project',
      'x-goog-api-client': 'genai-js/1.0',
      'x-goog-api-key': 'provider-key',
      'content-length': '42',
    })
  })

  it('preserves SSE response headers while removing hop-by-hop headers', () => {
    const result = createDownstreamHeaders({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-request-id': 'request-1',
      connection: 'keep-alive, x-remove-me',
      'x-remove-me': 'private',
      'transfer-encoding': 'chunked',
    })

    expect(result).toEqual({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-request-id': 'request-1',
    })
  })

  it('replaces a custom authentication header case-insensitively', () => {
    const result = createUpstreamHeaders(
      { 'x-custom-key': 'client-key', accept: 'application/json' },
      { 'X-Custom-Key': 'provider-key' },
      0,
    )

    expect(result).toEqual({
      accept: 'application/json',
      'X-Custom-Key': 'provider-key',
    })
  })
})
