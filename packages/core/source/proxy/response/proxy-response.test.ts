import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { BufferedProxyResponse, NodeProxyResponse } from '@server/proxy/response/proxy-response'

/**
 * 忠实反映 Node 的一处行为：`writeHead(status, headers)` 第二个参数里的头，写出去之后
 * 用 `getHeaders()` 读不回来。出口因此自己记账，这份替身也**不提供** `getHeaders`：
 * 一旦有人再回去回读宿主，测试会直接报错，而不是默默拿到一个空对象。
 */
function mockServerResponse() {
  const mock = {
    writableEnded: false,
    headersSent: false,
    destroyed: false,
    writeHead: vi.fn(() => { mock.headersSent = true }),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    setHeader: vi.fn(),
    statusCode: 200,
  }
  return mock as unknown as ServerResponse
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
    expect(response.sentHead()).toEqual({ statusCode: 201, headers: { 'content-type': 'application/json' } })
    expect(response.body).toBe('{"ok":true}')
    expect(response.headersSent).toBe(true)
    expect(response.writableEnded).toBe(true)
    expect(response.destroyed).toBe(false)
  })

  it('serializes failures and exposes destroyed errors', () => {
    const response = new BufferedProxyResponse()

    expect(response.fail(502, 'UPSTREAM_ERROR', 'upstream failed')).toEqual({
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: '{"success":false,"errorCode":"UPSTREAM_ERROR","errorMessage":"upstream failed"}',
      // 代理自己生成的失败响应在本进程里一次成形，不存在「只写了一半」。
      complete: true,
    })
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
  it('delegates response operations', () => {
    const serverResponse = mockServerResponse()
    const response = new NodeProxyResponse(serverResponse)

    response.start(201, { 'content-type': 'text/plain' })
    response.write('ok')
    response.end()
    response.destroy(new Error('closed'))
    // 发出去的头必须还能读回来：客户端视角的响应头就是从这里落库的，读不到就等于
    // 「返回客户端的响应」永远缺一半（只剩正文）。出口自己记账，不回读宿主。
    expect(response.headers()).toEqual({ 'content-type': 'text/plain' })
    expect(response.sentHead()).toEqual({ statusCode: 201, headers: { 'content-type': 'text/plain' } })
    expect(serverResponse.setHeader).toHaveBeenCalledWith('content-type', 'text/plain')
    expect(serverResponse.writeHead).toHaveBeenCalledWith(201)
    expect(serverResponse.write).toHaveBeenCalledWith('ok')
    expect(serverResponse.end).toHaveBeenCalled()
    expect(serverResponse.destroy).toHaveBeenCalled()
  })

  it('serializes a local failure when nothing has been sent yet', () => {
    const serverResponse = mockServerResponse()
    const response = new NodeProxyResponse(serverResponse)

    expect(response.fail(400, 'BAD_REQUEST', 'invalid body')).toEqual({
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: '{"success":false,"errorCode":"BAD_REQUEST","errorMessage":"invalid body"}',
      complete: true,
    })
    expect(serverResponse.setHeader).toHaveBeenCalledWith('content-type', 'application/json')
    expect(serverResponse.writeHead).toHaveBeenCalledWith(400)
    expect(serverResponse.end).toHaveBeenLastCalledWith(expect.stringContaining('BAD_REQUEST'))
  })

  it('keeps the headers it sent readable after they went out', () => {
    const serverResponse = mockServerResponse()
    const response = new NodeProxyResponse(serverResponse)

    response.start(200, { 'content-type': 'text/event-stream', 'x-upstream': 'provider-1' })

    expect(response.headersSent).toBe(true)
    expect(response.headers()).toEqual({ 'content-type': 'text/event-stream', 'x-upstream': 'provider-1' })
    expect(response.sentHead()).toEqual({ statusCode: 200, headers: { 'content-type': 'text/event-stream', 'x-upstream': 'provider-1' } })
  })

  it('skips undefined header values instead of handing them to setHeader', () => {
    const serverResponse = mockServerResponse()
    const response = new NodeProxyResponse(serverResponse)

    response.start(200, { 'content-type': 'application/json', 'x-absent': undefined })

    expect(serverResponse.setHeader).toHaveBeenCalledTimes(1)
    expect(serverResponse.setHeader).toHaveBeenCalledWith('content-type', 'application/json')
    expect(response.headers()).toEqual({ 'content-type': 'application/json' })
  })
})
