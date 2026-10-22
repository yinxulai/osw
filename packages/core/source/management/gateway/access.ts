/**
 * 管理 API 的边界：CORS、预检、路径、方法、凭证。
 *
 * 这一类判断只有**一个**调用方（`../gateway.ts`），所以它不发日志、不回状态码以外的信息，
 * 只回一个 `ApiAccess`：过了还是没过、没过是因为什么。日志与文档语气归网关，判据归这里。
 *
 * ## 只有一道门：本次启动的凭证
 *
 * 管理 API 只监听回环，但「只监听回环」不是访问控制：本机浏览器里任意一个网页都能向
 * `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」。所以这里只认**本次启动的
 * 凭证**（`x-osw-token`），它只活在这次启动的自家进程内存里（见 `../token.ts`），
 * 页面猜不到，也就发不出被接受的请求。
 *
 * 曾经这里还叠着 `Host` 白名单与 CORS 来源白名单。凭证到位之后它们的防御价值归零：
 *
 *   - **`Host` 白名单**挡的是 DNS rebinding，但 rebinding 的杀伤力取决于「攻击者的页面
 *     能不能读到响应」。凭证在请求头里，页面拿不到就发不出请求；反过来，凭证一旦泄漏，
 *     收紧 `Host` 也补不回来。所以它只剩一处用处——**决定要不要把凭证写进入口 HTML**，
 *     那件事归 `../gateway.ts`，不在这里。
 *   - **CORS 来源白名单**从来不是防线（它只决定浏览器允不允许页面读响应），只是让正常
 *     形态能跨源到达自己的进程。凭证到位之后它唯一的作用是制造「开发期换个端口就连不上」
 *     的故障，所以改成回显任何来源。
 *
 * 头里凡是「挡不住凭证持有者、又挡不住凭证泄漏」的检查，都是故障源，不留在这条链路上。
 *
 * ## 凭证为什么只卡浏览器
 *
 * 凭证**只活在内存里**（不落盘，见 `../token.ts`），于是别的进程读不到它——`osw stop` /
 * `osw status` 这类自家命令也就没法带上它。它们必须继续能用，所以这里把「是不是浏览器
 * 发来的」当成判据：
 *
 *   - 浏览器发的请求**一定**带 `Origin`（对非 `GET` 请求从无例外，`file://` 页面带
 *     `Origin: null`），Chromium 系还会带 `Sec-Fetch-Site`；这类请求必须凭证对得上，
 *     否则回 `401`。
 *   - 命令行、脚本、测试这类非浏览器客户端不会带这些头，直接放行。注意 Node 的 `fetch`
 *     会自发带 `Sec-Fetch-Mode: cors`，所以判据里**没有**它（见 `isBrowserRequest`）。
 *
 * 这个分界是安全的：真正的威胁模型是「用户打开了某个网页，那个网页替他调本机接口」。
 * 而同用户的本机进程本来就能读数据目录、能改配置，给它设一道需要落盘才能共享的口令，
 * 换来的是「多一份要保管的长期秘密」而挡不住任何东西。**不要**把这条例外扩展到浏览器：
 * 只要请求里有浏览器痕迹，就必须有凭证。
 */

import { timingSafeEqual } from 'node:crypto'
import { MANAGEMENT_TOKEN_HEADER } from '../token'
import { sendError } from '../core/response'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 被挡下的四种情形。网关只把它当日志字段用，不改行为。 */
export type ApiAccessRejection = 'preflight' | 'path' | 'method' | 'credential'

export type ApiAccess =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: ApiAccessRejection }

/** `/api/*` 全部是 `POST`；预检是浏览器自己发的，一起列进来。 */
const ALLOWED_METHODS = 'POST, OPTIONS'

/**
 * 这条请求能不能继续往下走。
 *
 * 顺序是固定的，且每一步都依赖前一步的结论：预检必须在凭证之前短路（浏览器自己发的，
 * 既不可能带自定义头，也不该被要求带）；路径与方法必须在凭证之前（对一条不存在的路径
 * 回 `401`，等于告诉对方「凭证不对」，而它想知道的其实是「这路径不存在」）。
 *
 * 不返回 `Promise`：这里没有任何异步操作，之前那个 `async` 只是让调用方多等一个 tick。
 */
export function checkApiAccess(req: IncomingMessage, res: ServerResponse, token: string | null): ApiAccess {
  const method = req.method
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  setCorsHeaders(req, res)

  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return { accepted: false, reason: 'preflight' }
  }

  if (!pathname.startsWith('/api/')) {
    sendError(res, 'RESOURCE_NOT_FOUND', `Management API path not found: ${pathname}`, 404, { path: pathname })
    return { accepted: false, reason: 'path' }
  }
  if (method !== 'POST') {
    sendError(res, 'METHOD_NOT_ALLOWED', `Only POST is supported, received ${method ?? 'UNKNOWN'}`, 405, { method: method ?? 'UNKNOWN' })
    return { accepted: false, reason: 'method' }
  }
  if (isBrowserRequest(req) && !hasValidToken(req, token)) {
    sendError(res, 'UNAUTHORIZED', 'Missing or invalid management token', 401)
    return { accepted: false, reason: 'credential' }
  }

  return { accepted: true }
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
 *
 * 同一个头出现两次时 Node 会把它交成数组。那不是「带了一份凭证」，是协议层的畸形请求，
 * 一律当不匹配：`timingSafeEqual` 只吃 Buffer，顺手取 `[0]` 反而让一份重复的头变成了
 * 有效凭证。
 */
function hasValidToken(req: IncomingMessage, expected: string | null): boolean {
  const provided = req.headers[MANAGEMENT_TOKEN_HEADER]
  // `expected` 为 null 意味着宿主没把凭证交下来。那是配置异常，不是「不设防」：
  // 这里必须返回 false，让浏览器请求被挡下，而不是静默地把门打开。
  if (expected === null) return false
  if (Array.isArray(provided)) return false
  if (typeof provided !== 'string' || provided.length === 0) return false

  const expectedBytes = Buffer.from(expected, 'utf8')
  const providedBytes = Buffer.from(provided, 'utf8')
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
