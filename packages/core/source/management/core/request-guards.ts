/**
 * 管理 API 的入口守卫：路径、方法与凭证。
 *
 * 管理 API 只监听回环，但「只监听回环」不是访问控制：本机浏览器里任意一个网页都能向
 * `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」。所以这里只有**一道**门：
 * **本次启动的凭证**（`x-osw-token`）。它只存在于本次启动的自家进程内存里
 * （见 `../token.ts`），页面猜不到，也就发不出被接受的请求。
 *
 * ## 为什么只剩这一道
 *
 * 曾经这里还叠着 `Host` 白名单与 CORS 来源白名单。凭证到位之后它们的防御价值归零：
 *
 *   - **`Host` 白名单**挡的是 DNS rebinding。但 rebinding 的杀伤力取决于「攻击者的页面
 *     能不能读到响应」，而凭证在请求头里，页面拿不到就发不出请求；反过来，凭证一旦
 *     泄漏，收紧 `Host` 也补不回来。所以它现在只留在**唯一会发出凭证的地方**——
 *     静态托管的入口 HTML 注入（`./static-web.ts`），那里才是真正的泄漏面。
 *   - **CORS 来源白名单**从来不是防线（它只决定浏览器允不允许页面读响应），只是让正常
 *     形态能跨源到达自己的进程。凭证到位之后，它唯一的作用是制造「开发期换个端口就
 *     连不上」的故障，所以改成回显任何来源。
 *
 * 结论：头里凡是「挡不住凭证持有者、又挡不住凭证泄漏」的检查，都是故障源，不留在链路上。
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

/** `/api/*` 全部是 `POST`；预检是浏览器自己发的，一起列进来。 */
const ALLOWED_METHODS = 'POST, OPTIONS'

export async function applyManagementRequestGuards(req: IncomingMessage, res: ServerResponse, token: string | null = null): Promise<boolean> {
  const method = req.method
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  setCorsHeaders(req, res)

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
 * CORS 头：来源一律回显。
 *
 * 这不是防线，只决定浏览器允不允许页面读响应——真正的门是凭证。收窄来源名单换不来任何
 * 安全性（拿不到凭证的页面照样读不到东西），却会让「开发期换了个端口」「用局域网 IP
 * 打开」这类正常场景直接连不上。
 *
 * `Access-Control-Allow-Headers` 回显预检里问的那一份：调用方将来多加一个头（比如调试用
 * 的追踪头）不必回来改这个文件。没问过就给 `*`。
 *
 * `Vary: Origin` 必须留：响应头跟着来源变，中间缓存不区分来源就会把一个来源的头喂给另一个。
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Headers', requestedHeaders(req))
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
}

function requestedHeaders(req: IncomingMessage): string {
  const requested = req.headers['access-control-request-headers']
  const value = Array.isArray(requested) ? requested.join(', ') : requested
  if (typeof value !== 'string' || value.trim().length === 0) return '*'
  return value
}
