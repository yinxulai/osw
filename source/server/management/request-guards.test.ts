import { describe, expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import { applyManagementRequestGuards } from './request-guards'

function mockResponse(): ServerResponse {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse
}

describe('management request guards', () => {
  it('handles CORS preflight without authentication', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(
      { host: '127.0.0.1:19301', origin: 'http://localhost:5173' },
      'OPTIONS',
      '/api/provider/list',
      response,
      '127.0.0.1',
      19301,
    )

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(204)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS')
    expect(response.end).toHaveBeenCalledOnce()
  })

  it('includes CORS headers in rejected requests', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(
      { host: 'example.com:19301' },
      'POST',
      '/api/provider/list',
      response,
      '127.0.0.1',
      19301,
    )

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(403)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
  })
})
