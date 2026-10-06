import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { applyManagementRequestGuards } from './core/request-guards'
import { mockResponse } from './test-support'

interface MockRequestOptions {
  method?: string
  url?: string
  origin?: string
}

/**
 * 守卫管两件事——路径/方法与 CORS 白名单。这里逐个断言，另外钉一条边界：
 * 它**不做**身份校验（本版本没有凭证，见 `apps/docs/specs/security-privacy.md`），
 * 任何一条 `/api/*` 的 POST 都会被放行到业务层。
 */
function mockRequest(options: MockRequestOptions): IncomingMessage {
  const headers: Record<string, string> = {}
  if (options.origin !== undefined) headers.origin = options.origin
  return { method: options.method ?? 'POST', url: options.url ?? '/api/provider/list', headers } as unknown as IncomingMessage
}

describe('management request guards', () => {
  it('handles CORS preflight', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'OPTIONS', origin: 'http://localhost:5173' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(204)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173')
    // `application/json` 不属于 CORS 的「简单值」，控制台每条写请求都要过预检；允许头里
    // 少了它，浏览器连真实请求都不发（Request header field content-type is not allowed ...）。
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS')
    // `Vary: Origin` 不能省：响应头跟着来源变，中间缓存（开发期的代理）不区分来源就会
    // 把一个来源的 CORS 头喂给另一个来源。
    expect(response.setHeader).toHaveBeenCalledWith('Vary', 'Origin')
    expect(response.end).toHaveBeenCalledOnce()
  })

  it('omits CORS headers for origins that are not the local console', async () => {
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'https://example.com' }), response)

    expect(response.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })

  it('echoes the opaque origin sent by the file:// renderer', async () => {
    // 生产形态的渲染进程从 `file://` 加载，只能用 `Origin: null` 表达自己。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'null' }), response)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'null')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type')
  })

  it('rejects non-API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ url: '/not-an-api-path' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(404)
  })

  it('rejects non-POST methods on API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'GET' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(405)
  })

  it('accepts a POST on an API path without any credential', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({}), response)

    expect(accepted).toBe(true)
    expect(response.setHeader).not.toHaveBeenCalled()
  })

  it('turns down origins that are not on http(s)', async () => {
    // 扩展页面的 origin 也是本地的，但**不是**我们的控制台。白名单放的是「本机页面」
    // 这个具体集合，不是「任何本机进程」这个抽象。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'chrome-extension://abcdefghijklmnop' }), response)

    expect(response.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })

  it('turns down an origin that cannot even be parsed', async () => {
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'not a url' }), response)

    expect(response.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })
})
