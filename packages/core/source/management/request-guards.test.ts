import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { applyManagementRequestGuards } from './core/request-guards'
import { mockResponse } from './test-support'

interface MockRequestOptions {
  method?: string
  url?: string
  origin?: string
  host?: string
  token?: string
  secFetchSite?: string
  secFetchMode?: string
  allowHeaders?: string
}

/** 本次启动的凭证。固定值，因为这里测的是「对不对得上」而不是「猜不猜得到」。 */
const TOKEN = 'test-management-token'

/**
 * 守卫管四件事：路径、方法、凭证与 CORS。这里逐个断言。
 *
 * 它**不**管 `Host`：凭证到位之后 `Host` 挡不住任何东西，只留下「用局域网 IP 打开就
 * 上不去」这类故障。唯一的回环判据在静态托管的凭证注入那里（`core/static-web.ts`）。
 *
 * 默认**不带** `Origin` / `Sec-Fetch-*`，也就是模拟命令行、脚本、测试这类非浏览器客户端。
 */
function mockRequest(options: MockRequestOptions): IncomingMessage {
  const headers: Record<string, string> = {}
  if (options.origin !== undefined) headers.origin = options.origin
  headers.host = options.host ?? '127.0.0.1:19301'
  if (options.token !== undefined) headers['x-osw-token'] = options.token
  if (options.secFetchSite !== undefined) headers['sec-fetch-site'] = options.secFetchSite
  if (options.secFetchMode !== undefined) headers['sec-fetch-mode'] = options.secFetchMode
  if (options.allowHeaders !== undefined) headers['access-control-request-headers'] = options.allowHeaders
  return { method: options.method ?? 'POST', url: options.url ?? '/api/provider/list', headers } as unknown as IncomingMessage
}

describe('management request guards', () => {
  it('handles CORS preflight without requiring a credential', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'OPTIONS', origin: 'http://localhost:5173', allowHeaders: 'content-type,x-osw-token' }), response, TOKEN)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(204)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173')
    // 允许头直接回显预检里问的那一份：调用方将来多加一个头不必回来改服务端。
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'content-type,x-osw-token')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS')
    // `Vary: Origin` 不能省：响应头跟着来源变，中间缓存（开发期的代理）不区分来源就会
    // 把一个来源的 CORS 头喂给另一个来源。
    expect(response.setHeader).toHaveBeenCalledWith('Vary', 'Origin')
    expect(response.end).toHaveBeenCalledOnce()
  })

  it('answers a preflight that asks for no headers with a wildcard', async () => {
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ method: 'OPTIONS', origin: 'http://localhost:5173' }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', '*')
  })

  it('echoes any origin instead of keeping a local whitelist', async () => {
    // 来源名单从来不是防线（它只决定浏览器允不允许读响应），真正的门是凭证。
    // 收窄它换不来安全性，只会让「开发期换了个端口」「用局域网 IP 打开」直接连不上。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'https://example.com', token: TOKEN }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com')
  })

  it('echoes the opaque origin sent by the file:// renderer', async () => {
    // 生产形态的渲染进程从 `file://` 加载，只能用 `Origin: null` 表达自己。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'null', token: TOKEN }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'null')
  })

  it('answers with a wildcard when the client sends no origin at all', async () => {
    // 命令行与脚本不发 `Origin`。这里回 `*` 而不是留空，是为了让「没有来源」与
    // 「来源不认得」不再有区别——后者那个分支已经删掉了。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ token: TOKEN }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
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

  it('does not refuse a request just because its Host is not loopback', async () => {
    // 以前这里会被 403。凭证成为唯一的门之后 `Host` 不再是访问控制：挡住它挡不住任何
    // 拿到凭证的调用方，也救不回任何泄漏的凭证。真正的回环判据在静态托管的注入那儿。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ host: 'evil.example.com', token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(true)
  })

  it('accepts the IPv6 loopback Host', async () => {
    // `[::1]:19301` 里冒号不止一个，是最容易在手工切 `:` 的实现里出错的一种写法。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ host: '[::1]:19301', token: TOKEN }), response, TOKEN)

    expect(accepted).toBe(true)
  })
})
