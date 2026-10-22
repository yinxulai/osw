import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { mockResponse } from '../test-support'
import { checkApiAccess } from './access'

interface MockRequestOptions {
  method?: string
  url?: string
  origin?: string
  token?: string
  secFetchSite?: string
  secFetchMode?: string
  allowHeaders?: string
}

/** 本次启动的凭证。固定值，因为这里测的是「对不对得上」而不是「猜不猜得到」。 */
const TOKEN = 'test-management-token'

/**
 * 边界只管四件事：路径、方法、凭证与 CORS。这里逐个断言。
 *
 * 默认**不带** `Origin` / `Sec-Fetch-*`，也就是模拟命令行、脚本、测试这类非浏览器客户端。
 */
function mockRequest(options: MockRequestOptions): IncomingMessage {
  const headers: Record<string, string> = { host: '127.0.0.1:19301' }
  if (options.origin !== undefined) headers.origin = options.origin
  if (options.token !== undefined) headers['x-osw-token'] = options.token
  if (options.secFetchSite !== undefined) headers['sec-fetch-site'] = options.secFetchSite
  if (options.secFetchMode !== undefined) headers['sec-fetch-mode'] = options.secFetchMode
  if (options.allowHeaders !== undefined) headers['access-control-request-headers'] = options.allowHeaders
  return {
    method: options.method ?? 'POST',
    url: options.url ?? '/api/provider/list',
    headers,
  } as unknown as IncomingMessage
}

describe('cors', () => {
  it('handles a preflight without requiring a credential', () => {
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ method: 'OPTIONS', origin: 'http://localhost:5173', allowHeaders: 'content-type,x-osw-token' }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'preflight' })
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

  it('answers a preflight that asks for no headers with a wildcard', () => {
    const response = mockResponse()

    checkApiAccess(mockRequest({ method: 'OPTIONS', origin: 'http://localhost:5173' }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', '*')
  })

  it('echoes any origin instead of keeping a local whitelist', () => {
    // 来源名单从来不是防线（它只决定浏览器允不允许读响应），真正的门是凭证。
    // 收窄它换不来安全性，只会让「开发期换了个端口」「用局域网 IP 打开」直接连不上。
    const response = mockResponse()

    checkApiAccess(mockRequest({ origin: 'https://example.com', token: TOKEN }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com')
  })

  it('echoes the opaque origin sent by the file:// renderer', () => {
    // 生产形态的渲染进程从 `file://` 加载，只能用 `Origin: null` 表达自己。
    const response = mockResponse()

    checkApiAccess(mockRequest({ origin: 'null', token: TOKEN }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'null')
  })

  it('answers with a wildcard when the client sends no origin at all', () => {
    // 命令行与脚本不发 `Origin`。这里回 `*` 而不是留空，是为了让「没有来源」与
    // 「来源不认得」不再有区别——后者那个分支已经删掉了。
    const response = mockResponse()

    checkApiAccess(mockRequest({ token: TOKEN }), response, TOKEN)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*')
  })
})

describe('path and method', () => {
  it('rejects a path that is not under /api/', () => {
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ url: '/not-an-api-path', token: TOKEN }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'path' })
    expect(response.statusCode).toBe(404)
  })

  it('rejects /api exactly, which is not a route either', () => {
    // `/api/` 带斜杠才是前缀，`/api` 本身不是——它落到 404 而不是被当成前缀切过去。
    const response = mockResponse()

    checkApiAccess(mockRequest({ url: '/api', token: TOKEN }), response, TOKEN)

    expect(response.statusCode).toBe(404)
  })

  it('rejects a non-POST method on an API path', () => {
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ method: 'GET', token: TOKEN }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'method' })
    expect(response.statusCode).toBe(405)
  })

  it('judges the method before the credential', () => {
    // 顺序有意义：对一条方法不对的请求回 401，等于说「凭证不对」，而它其实连
    // 「我要用这个方法」这件事都没问对。
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ method: 'DELETE', origin: 'http://localhost:5173' }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'method' })
    expect(response.statusCode).toBe(405)
  })
})

describe('credential', () => {
  it('accepts a POST that carries the credential', () => {
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ origin: 'http://localhost:5173', token: TOKEN }), response, TOKEN)

    expect(access).toEqual({ accepted: true })
  })

  it('rejects a browser POST without a credential', () => {
    // 最核心的一条：本机任意网页都能发这个请求，没有凭证就必须被挡住，
    // 否则 issue #76 里那条「沙箱 iframe 读走明文密钥」的路依然通着。
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ origin: 'http://localhost:5173' }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'credential' })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a browser POST that only carries Sec-Fetch-Site', () => {
    // 浏览器不一定给 `Origin`（同源 GET 就没有），但 Chromium 系总给 `Sec-Fetch-Site`，
    // 而且页面脚本改不了它。只看 `Origin` 会留下一个可以绕的缺口。
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ secFetchSite: 'same-origin' }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'credential' })
    expect(response.statusCode).toBe(401)
  })

  it('accepts a local client that only carries Sec-Fetch-Mode', () => {
    // Node 内置的 `fetch`（undici）会自发带 `sec-fetch-mode: cors`，而它确实不是浏览器。
    // 真实踩过一次：把 `Sec-Fetch-Mode` 当判据时 `osw stop` / `osw status` 全部 401，
    // 而这在单测里看不出来、只有连真进程的冒烟测试才暴露。
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ secFetchMode: 'cors' }), response, TOKEN)

    expect(access).toEqual({ accepted: true })
  })

  it('accepts a local client that shows no browser traces and no credential', () => {
    // 凭证只在宿主内存里，`osw stop` / `osw status` 读不到它。它们发出的请求没有
    // `Origin` 也没有 `Sec-Fetch-*`，正是这里判为非浏览器客户端的依据。
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({}), response, TOKEN)

    expect(access).toEqual({ accepted: true })
  })

  it('rejects a browser POST with the wrong credential', () => {
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ origin: 'http://localhost:5173', token: 'not-the-token' }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'credential' })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a browser credential of the right length but the wrong content', () => {
    // 长度相同但内容不同：专门走一遍 `timingSafeEqual` 的正常分支，而不是提前
    // 被长度比较挡在门外。
    const response = mockResponse()

    const access = checkApiAccess(mockRequest({ origin: 'http://localhost:5173', token: 'x'.repeat(TOKEN.length) }), response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'credential' })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a duplicated credential header that collapses to an array', () => {
    // 同一个头出现两次时 Node 会把它交成数组。`timingSafeEqual` 只吃 Buffer，
    // 直接传数组会抛——这里必须当成「不匹配」，而不是让请求边界接一个 500。
    const request = mockRequest({ origin: 'http://localhost:5173' })
    request.headers['x-osw-token'] = [TOKEN, TOKEN] as unknown as string
    const response = mockResponse()

    const access = checkApiAccess(request, response, TOKEN)

    expect(access).toEqual({ accepted: false, reason: 'credential' })
  })

  it('does not refuse a request just because its Host is not loopback', () => {
    // 以前这里会被 403。凭证成为唯一的门之后 `Host` 不再是访问控制：挡住它挡不住任何
    // 拿到凭证的调用方，也救不回任何泄漏的凭证。真正的回环判据在凭证注入那儿。
    const response = mockResponse()
    const request = mockRequest({ token: TOKEN })
    request.headers.host = 'evil.example.com'

    expect(checkApiAccess(request, response, TOKEN)).toEqual({ accepted: true })
  })

  it('refuses a browser request when the host handed over no credential', () => {
    // 宿主没把凭证交下来是配置异常，不是「不设防」。这时必须 fail-closed：
    // 静默放行等于「一个没配凭证的环境」自动变成一个对全网可写的环境。
    const response = mockResponse()

    expect(checkApiAccess(mockRequest({ origin: 'http://localhost:5173' }), response, null)).toEqual({ accepted: false, reason: 'credential' })
  })

  it('still lets a local process through when no credential was configured', () => {
    // 非浏览器通道不靠凭证，所以凭证缺失不会误伤 `osw stop` / `osw status`。
    const response = mockResponse()

    expect(checkApiAccess(mockRequest({}), response, null)).toEqual({ accepted: true })
  })
})
