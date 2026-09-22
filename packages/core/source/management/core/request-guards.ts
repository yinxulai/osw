/**
 * 管理 API 的入口守卫：路径、方法与 CORS。
 *
 * 这里**不做身份校验**。管理 API 监听回环并不等于安全：本机浏览器里任意一个网页都能向
 * `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」。要真正堵住这条口子得引入
 * 凭证，而这个软件现在**不向下签发任何调用方凭证**——管理面与代理入口都一样（见
 * docs/product/security-privacy.md 的「访问控制」）。当前只保留两件便宜的
 * 事，且都不假装自己是访问控制：
 *
 *   - 路由收口：只接 `/api/*` 的 `POST`，其余 404 / 405；
 *   - CORS 白名单：只回显 `null`（渲染进程经 `file://` 加载时的 opaque origin）与
 *     loopback 上的 origin（开发期的 Vite server），名单外的来源连响应都读不到。
 */

import { sendError } from './response'
import type { IncomingMessage, ServerResponse } from 'node:http'

export async function applyManagementRequestGuards(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const method = req.method
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  setCorsHeaders(req, res)

  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return false
  }

  if (!pathname.startsWith('/api/')) {
    sendError(res, 'RESOURCE_NOT_FOUND', `Management API path not found: ${pathname}`, 404, { path: pathname })
    return false
  }
  if (method !== 'POST') {
    sendError(res, 'METHOD_NOT_ALLOWED', `Only POST is supported, received ${method ?? 'UNKNOWN'}`, 405, { method: method ?? 'UNKNOWN' })
    return false
  }

  return true
}

/**
 * 只对「本机页面」回显 CORS 头。
 *
 * `Origin: null` 是渲染进程从 `file://` 加载时浏览器发的东西（页面是 opaque origin，
 * 只能这么表达自己），生产形态就靠它拿到读响应的许可。除此之外只放行 loopback——
 * 开发期控制台跑在 Vite server 上，是货真价实的跨源请求。
 *
 * `Content-Type` 必须列进 `Access-Control-Allow-Headers`：`application/json` 不属于 CORS
 * 的「简单值」，控制台每一条写请求都要先过预检，漏掉它预检永远过不去，浏览器连真实请求
 * 都不发，直接报 `Request header field content-type is not allowed by
 * Access-Control-Allow-Headers`。
 *
 * 不认识来源时**不回任何 CORS 头**：浏览器会挡住响应。记住了，这挡的是「读」不是「发」。
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !isLocalOrigin(origin)) return

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

function isLocalOrigin(origin: string): boolean {
  if (origin === 'null') return true
  try {
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}
