/**
 * 管理 API 的边界：CORS、预检、路径、方法、凭证。
 *
 * 这一类判断只有**一个**调用方（`../gateway.ts`），所以它不发日志、不回状态码以外的信息，
 * 只回一个 `ApiAccess`：过了还是没过、没过是因为什么。日志与文档语气归网关，判据归这里。
 *
 * ## 只有一道门：凭证
 *
 * 管理 API 只监听回环时，「只监听回环」也不是访问控制：本机浏览器里任意一个网页都能向
 * `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」。所以这里只认**凭证**。
 * 凭证有两种形态，任一有效即通过（见 `hasValidCredential`）：本次启动的 `x-osw-token`
 * （给本机进程），与登录换来的会话 cookie（给浏览器——真实服务器上浏览器拿不到 token）。
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
 * ## 凭证没有例外（正式形态）
 *
 * 正式形态下这是**无条件**的：每一条 `/api/*` 请求都要带着本次启动的凭证，不看它从哪儿来。
 * 开发形态（`environment === 'development'`）是唯一的例外，理由见下面「开发形态的旁路」。
 *
 * ## 开发形态的旁路
 *
 * 开发形态不校验凭证。判据只有「这次启动是不是开发形态」这一条，由调用方
 * （`../gateway.ts`）算成一个布尔值传进来，这里不回头读环境。
 *
 * 为什么值得开这个口子：管理接口的调用方只有自家前端，而开发期前端不是宿主加载的——
 * Vite 页面、`dev:preview`、调试脚本、自动化脚本都拿不到 `window.__OSW__` 里的凭证，
 * 于是每一次联调都要先把 `management.token` 读出来再塞进请求头，自动化开发直接卡住。
 * 开发形态的数据目录与正式形态是两个（见 `@common/runtime-profile`），演示数据与密钥
 * 都不共享，放宽它不会污染用户的实际数据。
 *
 * 代价要说清：开发形态下本机任意网页都能调 `/api/*`。只在本机跑开发实例时成立，
 * 且代理入口在两种形态下一样不校验调用方身份——这是开发便利换来的、有意识的取舍，
 * 不是漏掉的一步。正式形态（含命令行 `osw start`）仍然 fail-closed，见下面的说明。
 *
 * 不要把它和另一条曾经存在的例外混淆：那时是「请求里没有 `Origin` / `Sec-Fetch-*` 就当
 * 非浏览器客户端放行」，好让 `osw stop` / `osw status` 这些读不到内存凭证的自家命令用。
 * 那条判断是错的，而且错得很彻底：`Origin` / `Sec-Fetch-*` 是**调用方自己写的请求头**。
 * 任何本机进程（一个 `curl` 就够）不发这两个头就能直接调 `/api/provider/export` 拿走
 * 明文密钥。等于把门锁装在被拦的人手里；回环 TCP 对**同机其他用户**同样可达，他们连
 * 「故意不发头」都不用做。**判据不能来自请求内容**，只能来自启动配置——开发形态的旁路
 * 看的正是启动配置，与请求长什么样无关。
 *
 * 所以正式形态的形状是：凭证是唯一的门，且没有旁路；交付通道是数据目录里的 `0600` 文件
 * （见 `../token-file.ts`），随启动写入、随退出删除。
 *
 * 它挡得住本机网页、沙箱应用、容器、同机其他用户；挡不住**同一用户的**本机进程——那种
 * 进程本来就读得到数据目录。这一点是边界的形状，不是可以靠再加一层判断补上的漏洞：
 * 判据只可能来自请求内容或文件系统，而前者由对方掌控，后者对该用户全开。
 */

import { timingSafeEqual } from 'node:crypto'
import { MANAGEMENT_TOKEN_HEADER } from '../token'
import { sendError } from '../core/response'
import { getRequestSession } from '../auth/session-store'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 被挡下的四种情形。网关只把它当日志字段用，不改行为。 */
export type ApiAccessRejection = 'preflight' | 'path' | 'method' | 'credential'

export interface ApiAccessOptions {
  /**
   * 是否要求携带凭证。默认 `true`（fail-closed）；只有开发形态会传 `false`。
   *
   * 缺省必须是严的那个：忘了传不该顺手把门打开。
   */
  requireCredential?: boolean
  /**
   * **不需要凭证**的路径。只放「门本身」：登录、查会话、登出，以及首装时创建第一个账号。
   *
   * 这几条路必须能在没有凭证的情况下到达，否则就是「要进这扇门，先出这扇门」——服务器
   * 形态第一次打开时，用户手上既没有 token（浏览器拿不到，见 `./loopback.ts`）也没有
   * 会话（还没登录过）。
   *
   * 名单由网关传入而不是在这里写死：这几条路径与路由表属于同一份知识，网关是唯一同时
   * 看得见路由与访问控制的地方。这里只负责按名单短路，名单本身留在 `../gateway.ts`。
   */
  publicPaths?: ReadonlySet<string>
}

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
export function checkApiAccess(req: IncomingMessage, res: ServerResponse, token: string | null, options: ApiAccessOptions = {}): ApiAccess {
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
  // `requireCredential: false` 只由开发形态传下来，见文件头的「开发形态的旁路」。
  // 公开路径（登录、查会话、登出、首装建号）是第二条例外：它们是门本身。
  if (options.requireCredential !== false && !options.publicPaths?.has(pathname) && !hasValidCredential(req, token)) {
    sendError(res, 'UNAUTHORIZED', 'Missing or invalid management credential', 401)
    return { accepted: false, reason: 'credential' }
  }

  return { accepted: true }
}

/**
 * 这条请求带来的凭证是否有效。
 *
 * **两种凭证是并列的**，任一有效即通过：
 *
 *   - `x-osw-token`：本次启动的凭证，给本机进程用（`osw stop`、桌面主进程、注入进入口
 *     HTML 的前端）。
 *   - 会话 cookie：给**浏览器**用。真实服务器上浏览器拿不到 token（`Host` 不是回环地址时
 *     入口 HTML 刻意不注入，见 `../gateway/loopback.ts`），它是唯一可行的机制。
 *
 * 会话在这里不看 `managementAuthEnabled`：一张会话只可能来自一次成功的登录，也就是
 * 一次真实的口令证明。那个开关管的是「界面要不要拦人」，不是「这张票算不算数」——
 * 把两件事混在一起，会让「先建了账号、后来关掉登录」的机器上，已登录的人反而被踢出去。
 */
function hasValidCredential(req: IncomingMessage, token: string | null): boolean {
  return hasValidToken(req, token) || getRequestSession(req) !== null
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
  // 这里必须返回 false，让请求被挡下，而不是静默地把门打开。
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
    // 会话 cookie 是跨源带过来的（开发期控制台在 5173、管理服务在 9301），
    // 没有这个头浏览器既不会把 `Set-Cookie` 存下来，也不会随请求发出去。
    // 它只能与**具体来源**配对：`*` 与 credentials 互斥，浏览器会把整条响应判为
    // 不合格，于是「开发期换了个端口」这种正常场景反而彻底连不上。
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  } else {
    // 没有 `Origin` 说明不是浏览器发的（`osw stop`、脚本、服务端转发）。这类调用方
    // 本来就不存在「要不要带 cookie」的问题，于是这里只回 `*` 不声明 credentials——
    // 与上面那句互斥关系一一对应。
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
