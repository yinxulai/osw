import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { applyManagementRequestGuards } from './core/request-guards'
import { mockResponse } from './test-support'

interface MockRequestOptions {
  method?: string
  url?: string
  origin?: string
  host?: string | null
  token?: string
  secFetchSite?: string
  secFetchMode?: string
}

/** 本次启动的凭证。固定值，因为这里测的是「对不对得上」而不是「猜不猜得到」。 */
const TOKEN = 'test-management-token'

/**
 * 守卫管四件事：Host 白名单、凭证、路径/方法与 CORS。这里逐个断言。
 *
 * `host` 默认给回环地址：真实请求一定带 Host，不带上就等于在测一个不存在的形态。
 * 传 `null` 表示「这条请求没有 Host 头」。
 *
 * 默认**不带** `Origin` / `Sec-Fetch-*`，也就是模拟命令行、脚本、测试这类非浏览器客户端。
 */
function mockRequest(options: MockRequestOptions): IncomingMessage {
  const headers: Record<string, string> = {}
  if (options.origin !== undefined) headers.origin = options.origin
  if (options.host !== null) headers.host = options.host ?? '127.0.0.1:19301'
  if (options.token !== undefined) headers['x-osw-token'] = options.token
  if (options.secFetchSite !== undefined) headers['sec-fetch-site'] = options.secFetchSite
  if (options.secFetchMode !== undefined) headers['sec-fetch-mode'] = options.secFetchMode
  return { method: options.method ?? 'POST', url: options.url ?? '/api/provider/list', headers } as unknown as IncomingMessage
}

describe('management request guards', () => {
  it('handles CORS preflight without requiring a credential', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'OPTIONS', origin: 'http://localhost:5173' }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(204)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173')
    // `application/json` 与 `x-osw-token` 都不属于 CORS 的「简单值」，控制台每条写请求
    // 都要过预检；允许头里少了任何一个，浏览器连真实请求都不发
    // （Request header field ... is not allowed by Access-Control-Allow-Headers）。
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, X-OSW-Token')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS')
    // `Vary: Origin` 不能省：响应头跟着来源变，中间缓存（开发期的代理）不区分来源就会
    // 把一个来源的 CORS 头喂给另一个来源。
    expect(response.setHeader).toHaveBeenCalledWith('Vary', 'Origin')
    expect(response.end).toHaveBeenCalledOnce()
  })

  it('omits CORS headers for origins that are not the local console', async () => {
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'https://example.com' }), response, TOKEN)

    expect(response.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })

  it('echoes the opaque origin sent by the file:// renderer', async () => {
    // 生产形态的渲染进程从 `file://` 加载，只能用 `Origin: null` 表达自己。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'null', token: TOKEN }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'null')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, X-OSW-Token')
  })

  it('rejects non-API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ url: '/not-an-api-path', token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(404)
  })

  it('rejects non-POST methods on API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'GET', token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(405)
  })

  it('accepts a POST that carries the credential', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ origin: 'http://localhost:5173', token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(true)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173')
  })

  it('rejects a browser POST without a credential', async () => {
    // 最核心的一条：本机任意网页都能发这个请求，没有凭证就必须被挡住，
    // 否则 issue #76 里那条「沙箱 iframe 读走明文密钥」的路依然通着。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ origin: 'http://localhost:5173' }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(401)
  })

  it('rejects a browser POST that only carries Sec-Fetch-Site', async () => {
    // 浏览器不一定给 `Origin`（同源 GET 就没有），但 Chromium 系总给 `Sec-Fetch-Site`，
    // 而且页面脚本改不了它。只看 `Origin` 会留下一个可以绕的缺口。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ secFetchSite: 'same-origin' }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(401)
  })

  it('accepts a local client that only carries Sec-Fetch-Mode', async () => {
    // Node 内置的 `fetch`（undici）会自发带 `sec-fetch-mode: cors`，而它确实不是浏览器。
    // 真实踩过一次：把 `Sec-Fetch-Mode` 当判据时 `osw stop` / `osw status` 全部 401，
    // 而这在单测里看不出来、只有连真进程的冒烟测试才暴露。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ secFetchMode: 'cors' }), response, TOKEN)

    expect(accepted).toBe(true)
  })

  it('accepts a local client that shows no browser traces and no credential', async () => {
    // 凭证只在宿主内存里，`osw stop` / `osw status` 读不到它。它们发出的请求没有
    // `Origin` 也没有 `Sec-Fetch-*`，正是这里判为非浏览器客户端的依据。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({}), response, TOKEN)

    expect(accepted).toBe(true)
  })

  it('rejects a browser POST with the wrong credential', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ origin: 'http://localhost:5173', token: 'not-the-token' }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(401)
  })

  it('rejects a browser credential of the right length but the wrong content', async () => {
    // 长度相同但内容不同：专门走一遍 `timingSafeEqual` 的正常分支，而不是提前
    // 被长度比较挡在门外。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(
      mockRequest({ origin: 'http://localhost:5173', token: 'x'.repeat(TOKEN.length) }),
      response,
      TOKEN,
    )

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(401)
  })

  it('rejects a request whose Host is not a loopback address', async () => {
    // DNS rebinding：攻击者的域名解析到 127.0.0.1，请求在浏览器眼里就是同源的，
    // 于是 CORS 完全不参与，只有 Host 能把它认出来。凭证是对的也必须拒。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ host: 'evil.example.com', token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(403)
  })

  it('rejects a request without a Host header', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ host: null, token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(400)
  })

  it('accepts the IPv6 loopback Host', async () => {
    // `[::1]:19301` 里冒号不止一个，是最容易在手工切 `:` 的实现里出错的一种写法。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ host: '[::1]:19301', token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(true)
  })

  it('turns down origins that are not on http(s)', async () => {
    // 扩展页面的 origin 也是本地的，但**不是**我们的控制台。白名单放的是「本机页面」
    // 这个具体集合，不是「任何本机进程」这个抽象。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'chrome-extension://abcdefghijklmnop', token: TOKEN }), response, TOKEN)

    expect(response.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })

  it('turns down an origin that cannot even be parsed', async () => {
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'not a url', token: TOKEN }), response, TOKEN)

    expect(response.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })
})
