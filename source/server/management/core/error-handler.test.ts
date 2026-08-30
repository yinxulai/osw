import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  normalizeError: vi.fn(),
  sendManagementError: vi.fn(),
}))

vi.mock('@server/errors', () => ({ normalizeError: mocks.normalizeError }))
vi.mock('./response', () => ({ sendManagementError: mocks.sendManagementError }))

import { handleApiError } from './error-handler'

function mockRequest(method?: string, url?: string): IncomingMessage {
  return { method, url } as IncomingMessage
}

function mockResponse(overrides: Partial<ServerResponse> = {}): ServerResponse {
  return {
    headersSent: false,
    writableEnded: false,
    destroy: vi.fn(),
    ...overrides,
  } as unknown as ServerResponse
}

describe('handleApiError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.normalizeError.mockReturnValue({ code: 'INTERNAL_ERROR', statusCode: 500, message: 'boom' })
  })

  it('normalizes and sends management errors when response is writable', () => {
    const req = mockRequest('POST', '/api/run')
    const res = mockResponse()

    handleApiError(req, res, new Error('raw-error'))

    expect(mocks.normalizeError).toHaveBeenCalledWith(expect.any(Error))
    expect(mocks.sendManagementError).toHaveBeenCalledWith(res, { code: 'INTERNAL_ERROR', statusCode: 500, message: 'boom' })
    expect(res.destroy).not.toHaveBeenCalled()
  })

  it.each([
    { headersSent: true, writableEnded: false },
    { headersSent: false, writableEnded: true },
  ])('destroys response when it is no longer writable (%o)', state => {
    const req = mockRequest()
    const res = mockResponse(state)

    handleApiError(req, res, 'unknown-error')

    expect(res.destroy).toHaveBeenCalledWith({ code: 'INTERNAL_ERROR', statusCode: 500, message: 'boom' })
    expect(mocks.sendManagementError).not.toHaveBeenCalled()
  })

  it('logs with fallback method and url when request metadata is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const req = mockRequest(undefined as unknown as string, undefined as unknown as string)
    const res = mockResponse()

    handleApiError(req, res, new Error('x'))

    expect(spy).toHaveBeenCalledWith(
      '[management] request failed method=UNKNOWN path=/ status=500 code=INTERNAL_ERROR message=boom',
      { code: 'INTERNAL_ERROR', statusCode: 500, message: 'boom' },
    )
    spy.mockRestore()
  })
})
