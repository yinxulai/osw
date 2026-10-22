/**
 * 管理 API 的入口守卫：Host、路径、方法与凭证。
 *
 * 管理 API 只监听回环，但「只监听回环」不是访问控制：本机浏览器里任意一个网页都能向
 * `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」。所以这里叠了三层，各自
 * 挡一种具体的攻击，缺一层都会留出可用的口子（见 apps/docs/specs/security-privacy.md）：
 *
 *   - **Host 白名单**：挡 DNS rebinding。攻击者把自己的域名解析到 127.0.0.1，浏览器就
 *     认为请求与目标同源，CORS 直接失效；那种请求的 `Host` 是攻击者的域名，不是回环地址。
 *   - **本次启动的凭证**（`x-osw-token`）：挡「本机网页直接发请求」。凭证只存在于本次启动
 *     的自家进程内存里（见 `../token.ts`），页面猜不到，也就发不出被接受的请求。
 *   - **路由收口 + CORS 白名单**：只接 `/api/*` 的 `POST`，且只对回环来源回显 CORS 头。
 *
 * 顺序是有原因的：Host 必须最靠前。DNS rebinding 的请求在浏览器眼里是「同源」的，
 * 不会为它发预检，也就轮不到 CORS 说话；先验 Host 才能在它造成任何影响之前拦住。
 *
 * ## 凭证为什么只卡浏览器
 *
 * 凭证**只活在内存里**（不落盘，见 `../token.ts`），于是别的进程读不到它——`osw stop` /
 * `osw status` 这类自家命令也就没法带上它。它们必须继续能用，所以这里把「是不是浏览器
 * 发来的」当成判据：
 *
 *   - 浏览器发的请求**一定**带 `Origin`（对非 `GET` 请求从无例外，`file://` 页面带
 *     `Origin: null`），Chromium 系还会带 `Sec-Fetch-Site`；这类请求必须凭证对得上，
 *     否则 `401`。
 *   - 命令行、脚本、测试这类非浏览器客户端不会带这些头，直接放行。注意 Node 的
 *     `fetch` 会自发带 `Sec-Fetch-Mode: cors`，所以判据里**没有**它（见 `isBrowserRequest`）。
 *
 * 这个分界是安全的：真正的威胁模型是「用户打开了某个网页，那个网页替他调本机接口」。
 * 而同用户的本机进程本来就能读数据目录、能改配置，给它设一道需要落盘才能共享的口令，
 * 换来的是「多一份要保管的长期秘密」而挡不住任何东西。**不要**把这条例外扩展到浏览器：
 * 只要请求里有浏览器痕迹，就必须有凭证。
 */

import { timingSafeEqual } from 'node:crypto'
import { MANAGEMENT_TOKEN_HEADER } from '../token'
import { sendError } from './response'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 凭证必须列进 `Access-Control-Allow-Headers`，否则每一条带凭证的跨源请求都会卡在预检上：
 * 浏览器连真实请求都不发，直接报 `x-osw-token is not allowed by Access-Control-Allow-Headers`。
 */
const ALLOWED_REQUEST_HEADERS = 'Content-Type, X-OSW-Token'

/**
 * 校验 `Host` 头是否指向回环地址。
 *
 * 导出是因为调用方必须在**静态托管之前**先跑它：静态文件与 API 挂在同一个端口上，先发
 * 文件就等于先把「被 rebinding 的域名加载了这个页面」这件事做完了，再拦 API 也补不回来。
 *
 * 返回 `true` 表示放行；返回 `false` 时已经写出了错误响应。
 */
export function checkManagementHost(req: IncomingMessage, res: ServerResponse): boolean {
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) {
    sendError(res, 'VALIDATION_ERROR', 'Missing Host header', 400)
    return false
  }
  if (!isLoopbackHost(host)) {
    // 不把收到的 Host 回显给调用方：这条响应可能正落在攻击者页面的视野里。
    console.warn(`[management] rejected request with unexpected host=${host}`)
    sendError(res, 'FORBIDDEN', 'Host is not allowed', 403)
    return false
  }
  return true
}

export async function applyManagementRequestGuards(req: IncomingMessage, res: ServerResponse, token: string | null = null): Promise<boolean> {
  const method = req.method
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  setCorsHeaders(req, res)

  if (!checkManagementHost(req, res)) return false

  // 预检必须在凭证之前短路：预检请求是浏览器自己发的，它既不可能带自定义头，
  // 也不该被要求带。
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
  if (!hasValidToken(req, token) && isBrowserRequest(req)) {
    sendError(res, 'UNAUTHORIZED', 'Missing or invalid management token', 401)
    return false
  }

  return true
}

/**
 * 这条请求是不是浏览器发来的。
 *
 * 判据只用两样东西：
 *
 *   - `Origin`：浏览器对所有非 `GET` / `HEAD` 请求都会带（`file://` 页面表达成 `null`），
 *     而网页发起的写请求捕获不到例外。跨源、同源 `POST` 都在内。
 *   - `Sec-Fetch-Site`：Chromium 系对所有请求都会加，页面脚本无法改写。它是 `Origin`
 *     之外的第二个佐证，不是替代品。
 *
 * ⚠️ **不要用 `Sec-Fetch-Mode`**，尽管 Chromium 系确实对它从不缺席：Node 内置的
 * `fetch`（undici）也会自己加一条 `sec-fetch-mode: cors`。把它算进判据，命令行就会被
 * 当成浏览器，`osw stop` / `osw status` 一律 401。这个坑单测发现不了（替身请求想带什么
 * 就带什么），是 `pnpm smoke:cli` 连真进程时才炸出来的——所以这里留一条记号，别再加回来。
 * `Sec-Fetch-Dest` 同理不可靠。
 */
function isBrowserRequest(req: IncomingMessage): boolean {
  if (typeof req.headers.origin === 'string') return true
  if (typeof req.headers['sec-fetch-site'] === 'string') return true
  return false
}

/**
 * `Host` 去掉端口后必须是回环地址。
 *
 * 用 `URL` 解析而不是自己按 `:` 切——IPv6 的写法（`[::1]:19301`）里冒号不止一个，手工切
 * 必然出错。解析失败（畸形 Host）一律当不合法。
 */
function isLoopbackHost(host: string): boolean {
  try {
    const { hostname } = new URL(`http://${host}`)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

/**
 * 定长比较。
 *
 * `timingSafeEqual` 在长度不同时会抛错，所以先比长度。这里泄露的「长度对不对」无所谓：
 * 长度是固定值，攻击者从协议文档就能知道，真正需要保护的是内容。
 */
function hasValidToken(req: IncomingMessage, expected: string | null): boolean {
  const provided = req.headers[MANAGEMENT_TOKEN_HEADER]
  const value = Array.isArray(provided) ? provided[0] : provided
  if (!expected || typeof value !== 'string' || value.length === 0) return false

  const expectedBytes = Buffer.from(expected, 'utf8')
  const providedBytes = Buffer.from(value, 'utf8')
  if (expectedBytes.length !== providedBytes.length) return false
  return timingSafeEqual(expectedBytes, providedBytes)
}

/**
 * 只对「本机页面」回显 CORS 头。
 *
 * `Origin: null` 是渲染进程从 `file://` 加载时浏览器发的东西（页面是 opaque origin，
 * 只能这么表达自己），生产形态就靠它拿到读响应的许可。除此之外只放行 loopback——
 * 开发期控制台跑在 Vite server 上，是货真价实的跨源请求。
 *
 * `Content-Type` 与 `X-OSW-Token` 都必须列进 `Access-Control-Allow-Headers`：两者都不属于
 * CORS 的「简单值」，控制台每一条写请求都要先过预检，漏掉任何一个预检都永远过不去。
 *
 * 不认识来源时**不回任何 CORS 头**：浏览器会挡住响应。记住了，这挡的是「读」不是「发」。
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !isLocalOrigin(origin)) return

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_REQUEST_HEADERS)
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
