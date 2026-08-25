import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApiRequest } from './router'

function mockResponse() {
  return { statusCode: 0, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
}

function responsePayload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0]?.[0])) as Record<string, unknown>
}

function request(url: string, method = 'POST'): IncomingMessage {
  return { url, method } as IncomingMessage
}

describe('management router', () => {
  it('returns not found for an unknown API path', async () => {
    const response = mockResponse()

    await handleApiRequest(request('/api/does-not-exist'), response)

    expect(response.statusCode).toBe(404)
    expect(responsePayload(response)).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('hides development-only paths outside development', async () => {
    const response = mockResponse()

    await handleApiRequest(request('/api/config/seed-development'), response, 'production')

    expect(response.statusCode).toBe(404)
    expect(responsePayload(response)).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
  })
})
