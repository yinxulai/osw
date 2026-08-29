import { describe, expect, it, vi } from 'vitest'
import type { ServerResponse } from 'node:http'
import { applyManagementRequestGuards } from './core/request-guards'

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

    const accepted = await applyManagementRequestGuards('OPTIONS', '/api/provider/list', response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(204)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS')
    expect(response.end).toHaveBeenCalledOnce()
  })

  it('rejects non-API paths with CORS headers', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards('POST', '/not-an-api-path', response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(404)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
  })

  it('rejects non-POST methods on API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards('GET', '/api/provider/list', response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(405)
  })

  it('accepts POST requests on API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards('POST', '/api/provider/list', response)

    expect(accepted).toBe(true)
  })
})
