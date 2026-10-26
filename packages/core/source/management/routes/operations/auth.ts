/**
 * 管理面登录的路由组。
 *
 * 这几条是**门本身**：网关把它们放进 `PUBLIC_API_PATHS`，不带凭证也能到达
 * （见 `../gateway.ts`）。除此之外的管理接口一条都不在这里，也不需要知道登录的存在——
 * 一道门开在最前面，后面所有路由都只面对「已通过」的请求。
 *
 * ## 授权规则写在哪
 *
 * 网关只回答「这条请求有没有凭证」。**账号管理**的授权是另一层判断，写在本文件里：
 *
 *   - 建账号：库里一个账号都没有时**谁都能建**（首装，否则服务器形态永远进不去）；
 *     已经有账号时**必须带启动凭证或已有会话**——这就是「加人」这个动作的授权。
 *   - 列账号 / 改口令 / 删账号：必须带凭证。
 *
 * 为什么这条规则不放网关：网关给出的是一个**布尔值**（有没有凭证），而这里需要的是
 * 「库里有没有账号」这个业务事实。把业务事实搬进网关，就等于把「账号」这个概念塞进那条
 * 只该认启动配置的链路（见 `../gateway/access.ts` 文件头）。
 *
 * ## 校验交给谁
 *
 * 用户名与口令的规则只写在 `database/user-store.ts` 一处（`assertUsername` /
 * `assertPasswordStrength`），本文件不重复实现。所以这里的入参只做「取出来」这一件事，
 * 取值不合法时由存储层给出带 `details` 的领域错误码（`MANAGEMENT_WEAK_PASSWORD` 等），
 * 界面才能说清「差在哪儿」，而不是一句泛化的 `VALIDATION_ERROR`。
 */

import { z } from 'zod'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthSessionSchema, LoginRequestSchema } from '@common/auth'
import {
  changePassword,
  createAccount,
  deleteAccount,
  hasAnyAccount,
  listAccounts,
  verifyCredentials,
} from '@server/database/user-store'
import { hasValidStartupToken } from '../../token'
import { describeSession } from '../../auth/service'
import { createSession, clearSessionCookie, getRequestSession, revokeSession, revokeUserSessions, setSessionCookie } from '../../auth/session-store'
import { sendError, sendSuccess, type ManagementHandler } from '../../core/response'
import { HttpRouter } from '@server/http-router'

export const authRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/auth/session', handleSession)
  .post('/api/auth/login', handleLogin)
  .post('/api/auth/logout', handleLogout)
  .post('/api/auth/account/create', handleCreateAccount)
  .post('/api/auth/account/list', handleListAccounts)
  .post('/api/auth/account/delete', handleDeleteAccount)
  .post('/api/auth/account/password', handleChangePassword)

/**
 * 当前会话。
 *
 * 它是前端的**第一个**请求：登录页要不要出现、要不要显示「还没有账号」，全靠它。
 * 不需要凭证——一个还没登录的浏览器必须能问出「我要不要登录」。
 */
async function handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, AuthSessionSchema.parse(await describeSession(req)))
}

/**
 * 登录。
 *
 * 失败时**不区分**「没这个账号」与「口令不对」：两种都回 `MANAGEMENT_INVALID_CREDENTIALS`。
 * 分开报错等于送出一张用户名清单，而在一个可能对公网开放的接口上，那份清单就是接下来
 * 爆破的目标。存储层已经保证两条路径耗时一致（见 `database/user-store.ts` 的
 * `verifyCredentials`）。
 */
async function handleLogin(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = LoginRequestSchema.parse(body)

  // 库里没有账号时，这不是「登录失败」而是「还没设防」。回一个能照做的错误码，登录页
  // 据此显示「去终端跑 user add」，而不是让用户对着一个永远登不进去的表单反复试。
  if (!(await hasAnyAccount())) {
    sendError(res, 'MANAGEMENT_ACCOUNT_MISSING', 'no management account has been created yet', 409)
    return
  }

  const account = await verifyCredentials(input.username, input.password)
  if (!account) {
    sendError(res, 'MANAGEMENT_INVALID_CREDENTIALS', 'invalid username or password', 401)
    return
  }

  const remember = input.remember === true
  const session = createSession(account.id, account.username, remember)
  setSessionCookie(req, res, session, remember)
  // 应答体必须由**刚建好的那张票**拼出来，不能回头调 `describeSession(req)`：
  // 那个函数读的是**请求**里的 `Cookie`，而这次登录的票是写进**响应**的 `Set-Cookie`，
  // 请求里按定义不可能已经有它。于是刚登录成功的应答会自称 `authenticated: false`，
  // 界面把它存进缓存后判定「没登上」，直接把人退回登录页——一个只在浏览器里出现、
  // 服务端 curl 一路正常的故障（见 `useLogin` 的 `setQueryData`）。
  sendSuccess(res, AuthSessionSchema.parse({
    required: true,
    authenticated: true,
    hasUsers: true,
    username: session.username,
    expiresTime: session.expiresTime,
  }))
}

/**
 * 登出。
 *
 * 无论有没有会话都回成功：重试一次「登出」不该报错，而「这张票本来就无效」与
 * 「刚被你删掉」对调用方是同一件事。
 */
async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = getRequestSession(req)
  if (session) revokeSession(session.id)
  clearSessionCookie(res)
  sendSuccess(res, AuthSessionSchema.parse(await describeSession(req)))
}

/**
 * 建账号。
 *
 * 两条通道：
 *
 *   1. **首装**：库里一个账号都没有。此时不要求凭证——服务器形态第一次打开时，用户手上
 *      既没有 token（浏览器拿不到，见 `../gateway/loopback.ts`）也没有会话（还没登录过），
 *      不给这条通道就是死锁。
 *   2. **加人**：已经有账号，必须带启动凭证或已有会话。
 *
 * 首装通道是**一次性**的：第一条记录落库之后，任何再来的人都会被第二类规则拦住。
 */
async function handleCreateAccount(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CredentialsSchema.parse(body)

  if (await hasAnyAccount()) {
    requireAccountAccess(req, res)
    if (res.writableEnded) return
  }

  sendSuccess(res, await createAccount(input.username, input.password))
}

/** 列账号。必须带凭证——一份账号名单是爆破的起点。 */
async function handleListAccounts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  requireAccountAccess(req, res)
  if (res.writableEnded) return
  sendSuccess(res, await listAccounts())
}

/**
 * 删账号。
 *
 * 被删账号的会话一起吊销：连着的那几张票如果还能用，删除就只是删掉了一行记录，
 * 而浏览器里那个窗口仍然能导出明文密钥。
 */
async function handleDeleteAccount(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  requireAccountAccess(req, res)
  if (res.writableEnded) return

  const { id } = AccountIdSchema.parse(body)
  await deleteAccount(id)
  revokeUserSessions(id)
  sendSuccess(res, await listAccounts())
}

/** 改口令。同样吊销该账号的其它会话：口令被改，通常意味着旧口令已经不该能用了。 */
async function handleChangePassword(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  requireAccountAccess(req, res)
  if (res.writableEnded) return

  const input = ChangePasswordSchema.parse(body)
  await changePassword(input.id, input.password)
  revokeUserSessions(input.id)
  sendSuccess(res, await listAccounts())
}

/**
 * 账号管理接口的授权：启动凭证**或**有效会话，二选一。
 *
 * 与网关第 5 步是同一个意思，但不能复用那个函数：网关放行了公开路径（`create` 就是其中
 * 一条），所以本文件必须自己再判一次「有没有资格改账号」。两处的作用对象不同——
 * 网关判「所有 `/api/*`」，这里判「账号管理」。
 *
 * 同步执行、不返回 Promise 是刻意的：两个判据都在内存里，而调用方紧接着要检查
 * `res.writableEnded`——留一个 await 只会让人以为中间还有别的时序。
 */
function requireAccountAccess(req: IncomingMessage, res: ServerResponse): void {
  if (hasValidStartupToken(req)) return
  if (getRequestSession(req) !== null) return
  sendError(res, 'UNAUTHORIZED', 'missing or invalid management credential', 401)
}

/**
 * 入参只收敛形状，不校验内容。
 *
 * 用户名与口令的规则在存储层（文件头说过为什么），这里判的只是「字段在不在、是不是字符串」。
 * 缺字段是**调用方写错了请求**，不是用户填错了表单，所以给 `VALIDATION_ERROR` 就够了，
 * 界面不必为它准备文案。zod 抛出的错误由 `handleApiError` 统一成 400。
 */
const CredentialsSchema = z.object({ username: z.string(), password: z.string() })
const AccountIdSchema = z.object({ id: z.string().min(1) })
const ChangePasswordSchema = z.object({ id: z.string().min(1), password: z.string() })
