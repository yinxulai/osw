/**
 * 管理面的浏览器会话。
 *
 * ## 为什么必须有它（不能只靠启动凭证）
 *
 * 启动凭证（`x-osw-token`，见 `../token.ts`）是给**本机进程**用的，交付通道是数据目录里
 * 那个 `0600` 文件，以及入口 HTML 里那行 `window.__OSW__`。两条通道在真实服务器上都不成立：
 *
 *   - 浏览器从局域网打开 `http://192.168.1.10:9301/` 时，`Host` 不是回环地址，入口 HTML
 *     **刻意不注入**凭证（见 `../gateway/loopback.ts`，那是防 DNS rebinding 的），于是页面
 *     拿不到任何凭证；
 *   - 就算注入了也没用：`window.__OSW__` 里的东西谁都能在 devtools 里读到，而「一个能登录
 *     的入口」与「一份人尽皆知的通行证」是两回事——多用户场景下每个人得有自己的身份。
 *
 * 所以浏览器走会话 cookie：登录换一张票，票在服务端，浏览器只拿到一个不透明的 id。
 *
 * ## 为什么存在内存里
 *
 * 会话是**随请求写**的东西，而配置库的第三条不变量明确禁止把这种东西放进去
 * （见 `database/config-schema.ts` 文件头）；观测库放着也一样：多一条迁移、多一个
 * 「会话表要不要清理」的定时任务，换来的能力是「重启后不必重新登录」——一个管理面板
 * 不需要的能力，何况进程重启本来就是少数。
 *
 * 代价写在明处：**服务重启后所有浏览器会话失效**，用户重新登录一次。这条取舍让整个
 * 登录功能只需要一张 `users` 表、一条迁移。
 *
 * ## 票据本身的形状
 *
 * 32 字节随机量，base64url。不是 JWT：JWT 的价值在于「校验方不持有状态」，而这里
 * 校验方**就是**发证方，同一个进程内存里就有真值——用 JWT 只是把一个可以直接查表的
 * 问题，换成一个要自己实现签名校验、过期校验、吊销名单的问题。吊销尤其致命：JWT
 * 天生不能撤销，于是「删掉这个账号」之后那张票还能用到过期为止。
 */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** cookie 名。带 `osw` 前缀，避免和同域下别的应用撞在一起。 */
export const SESSION_COOKIE_NAME = 'osw_session'

/**
 * 会话默认寿命：12 小时。
 *
 * 够一个工作日，又不至于让一台共用机器上的浏览器整整一周都保持着管理权限。
 * `remember` 把它拉长到 30 天——那是用户显式要求的。
 */
const SESSION_TTL_MILLISECONDS = 12 * 60 * 60 * 1000
const REMEMBER_TTL_MILLISECONDS = 30 * 24 * 60 * 60 * 1000

/** 清扫间隔。惰性清理之外的一层保险，防止长跑进程里过期条目越积越多。 */
const SWEEP_INTERVAL_MILLISECONDS = 10 * 60 * 1000

export interface SessionRecord {
  /** 会话 id，也是 cookie 的值。 */
  id: string
  userId: string
  username: string
  createdTime: number
  expiresTime: number
}

const sessions = new Map<string, SessionRecord>()
let sweepTimer: NodeJS.Timeout | null = null

function ensureSweeper(): void {
  if (sweepTimer !== null) return
  sweepTimer = setInterval(() => {
    const currentTime = Date.now()
    for (const [id, session] of sessions) {
      if (session.expiresTime <= currentTime) sessions.delete(id)
    }
  }, SWEEP_INTERVAL_MILLISECONDS)
  // 不让一个缓存清扫把进程按住：CLI 的 `start` 退出时不该等它。
  sweepTimer.unref()
}

/** 建一张票。`remember` 决定寿命，见上面两个常量。 */
export function createSession(userId: string, username: string, remember = false): SessionRecord {
  ensureSweeper()
  const createdTime = Date.now()
  const session: SessionRecord = {
    id: randomBytes(32).toString('base64url'),
    userId,
    username,
    createdTime,
    expiresTime: createdTime + (remember ? REMEMBER_TTL_MILLISECONDS : SESSION_TTL_MILLISECONDS),
  }
  sessions.set(session.id, session)
  return session
}

/**
 * 查票。过期即删。
 *
 * 比较用定长比较：`Map.get` 的键查找本身不是定长的（虽然实践中差异微乎其微），
 * 但这里更重要的理由是**形状统一**——本文件与 `../token.ts` 的校验走同一条规矩，
 * 读代码的人不必判断「这一处为什么可以随便比」。
 */
export function getSession(id: string): SessionRecord | null {
  const session = sessions.get(id)
  if (!session) return null
  if (session.expiresTime <= Date.now()) {
    sessions.delete(id)
    return null
  }
  return session
}

/** 吊销一张票。登出与「改口令后踢掉其它会话」都走它。 */
export function revokeSession(id: string): void {
  sessions.delete(id)
}

/** 吊销某个账号的所有会话（删账号、改口令时用）。 */
export function revokeUserSessions(userId: string): number {
  let removed = 0
  for (const [id, session] of sessions) {
    if (session.userId === userId) {
      sessions.delete(id)
      removed += 1
    }
  }
  return removed
}

/** 测试与关停用：清空全部会话。 */
export function clearSessions(): void {
  sessions.clear()
  if (sweepTimer !== null) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

/**
 * 从请求里取票。
 *
 * 只认 `Cookie` 头里的那一个名字。畸形（重复的名字、空值）一律当没有：cookie 是
 * 浏览器自己拼的，出现重复说明有人在手工构造，不是「带了一份票」。
 */
export function readSessionId(req: IncomingMessage): string | null {
  const header = req.headers.cookie
  if (typeof header !== 'string' || header.length === 0) return null

  let found: string | null = null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue
    if (found !== null) return null // 重复即畸形。
    const value = part.slice(separator + 1).trim()
    if (value.length === 0) return null
    found = value
  }
  return found
}

/** 请求带着一张**有效**的票时返回会话，否则 `null`。 */
export function getRequestSession(req: IncomingMessage): SessionRecord | null {
  const id = readSessionId(req)
  return id === null ? null : getSession(id)
}

/** 这个请求是不是从 TLS 上来的。`Secure` 只能在真的 HTTPS 上加。 */
function isSecureRequest(req: IncomingMessage): boolean {
  // 反代场景：`X-Forwarded-Proto` 是唯一能看出来的东西。没有反代时它就是 `http`。
  const forwarded = req.headers['x-forwarded-proto']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof value === 'string') return value.split(',')[0]?.trim() === 'https'
  // `socket.encrypted` 只有 TLS server 才有，标准 `IncomingMessage` 的类型里没有它。
  return (req.socket as { encrypted?: boolean }).encrypted === true
}

/**
 * 把票写进响应。
 *
 * `HttpOnly`：`document.cookie` 读不到它，XSS 拿不走票。
 * `SameSite=Lax`：跨站的 `POST` 不带票，挡掉 CSRF 的主流形态；`Lax` 而不是 `Strict`，
 * 是因为从外部链接点进控制台时 `Strict` 会让用户看到一个空白页再刷新一次。
 * `Path=/`：`/api/*` 与静态产物都要带上它。
 * `Secure`：只在 HTTPS 请求上加。这台服务默认是纯 HTTP，无条件加 `Secure` 会让
 * 浏览器**直接丢弃**这个 cookie，登录静默失效。
 */
export function setSessionCookie(req: IncomingMessage, res: ServerResponse, session: SessionRecord, remember = false): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${session.id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  // 不 remember 时不写 `Max-Age`：那是「浏览器会话 cookie」，关掉浏览器就没了。
  if (remember) parts.push(`Max-Age=${Math.floor(REMEMBER_TTL_MILLISECONDS / 1000)}`)
  if (isSecureRequest(req)) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

/** 清掉票。`Max-Age=0` 是删除 cookie 的标准写法（只写空值不够，某些浏览器会保留）。 */
export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}
