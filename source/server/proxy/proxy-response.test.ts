import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { BufferedProxyResponse, NodeProxyResponse, asIncomingHeaders } from './proxy-response'

function mockServerResponse() {
  return {
    writableEnded: false,
    headersSent: false,
    destroyed: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    getHeaders: vi.fn(() => ({ 'x-request-id': 'request-1' })),
    setHeader: vi.fn(),
    statusCode: 200,
  } as unknown as ServerResponse
}

describe('BufferedProxyResponse', () => {
  it('buffers a response and ignores repeated starts', () => {
    const response = new BufferedProxyResponse()

    response.start(201, { 'content-type': 'application/json' })
    response.start(500, { 'x-ignored': 'true' })
    response.write('{"ok":')
    response.write('true}')
    response.end()

    expect(response.statusCode).toBe(201)
    expect(response.headers()).toEqual({ 'content-type': 'application/json' })
    expect(response.body).toBe('{"ok":true}')
    expect(response.headersSent).toBe(true)
    expect(response.writableEnded).toBe(true)
    expect(response.destroyed).toBe(false)
  })

  it('serializes failures and exposes destroyed errors', () => {
    const response = new BufferedProxyResponse()

    expect(response.fail(502, 'UPSTREAM_ERROR', 'upstream failed')).toBe(
      '{"success":false,"errorCode":"UPSTREAM_ERROR","errorMessage":"upstream failed"}',
    )
    expect(response.statusCode).toBe(502)
    expect(response.body).toContain('UPSTREAM_ERROR')
    expect(response.writableEnded).toBe(true)

    const error = new Error('connection reset')
    response.destroy(error)
    expect(response.destroyed).toBe(true)
    expect(response.failureMessage).toBe('connection reset')
  })
})

describe('NodeProxyResponse', () => {
  it('delegates response operations and writes JSON failures', () => {
    const serverResponse = mockServerResponse()
    const response = new NodeProxyResponse(serverResponse)

    response.start(201, { 'content-type': 'text/plain' })
    response.write('ok')
    response.end()
    response.destroy(new Error('closed'))
    expect(response.headers()).toEqual({ 'x-request-id': 'request-1' })
    expect(serverResponse.writeHead).toHaveBeenCalledWith(201, { 'content-type': 'text/plain' })
    expect(serverResponse.write).toHaveBeenCalledWith('ok')
    expect(serverResponse.end).toHaveBeenCalled()
    expect(serverResponse.destroy).toHaveBeenCalled()

    response.fail(400, 'BAD_REQUEST', 'invalid body')
    expect(serverResponse.statusCode).toBe(400)
    expect(serverResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    expect(serverResponse.end).toHaveBeenLastCalledWith(expect.stringContaining('BAD_REQUEST'))
  })
})

describe('asIncomingHeaders', () => {
  it('preserves outgoing header values', () => {
    const headers = { 'x-test': 'value' }
    expect(asIncomingHeaders(headers)).toBe(headers)
  })
})
