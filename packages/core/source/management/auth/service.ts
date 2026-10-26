/**
 * 管理面登录的**判断层**：这次请求算不算已通过、这台服务要不要登录、登录页该看到什么。
 *
 * 三个宿主（桌面 App、命令行本机、命令行服务器）共用这一套。它们只在**默认值**上不同，
 * 那条差别写在 `runtime/server-runtime.ts` 一处（按监听地址算），不在这里，也不在网关里。
 *
 * ## 唯一的事实来源
 *
 * 「这次要不要登录」= `settings.managementAuthEnabled && 库里存在账号`。
 *
 * 为什么必须**同时**满足两条：
 *
 *   - 只判设置：服务器形态默认开，但用户还没建账号——那时如果照样要求登录，服务器起来
 *     就登不进去，而它的错误页又会说「口令错误」，用户只能去翻文档。所以「没有账号」
 *     等于「这台服务还没设防」，直接放行；CLI 的 `start` 在监听非回环地址时会拦下这种
 *     情况（见 `apps/cli/source/commands/start.ts`），不让一台裸奔的服务器起来。
 *   - 只判账号：桌面用户建过一个账号只是想试试，之后每一次开 App 都要登录——那不是他
 *     要的。关掉设置就该真的不要求。
 *
 * ## 为什么不在网关里现判
 *
 * `gateway/access.ts` 的判据只能来自启动配置（文件头那条反复强调的原则）。设置是**启动
 * 之后可以改的**（用户在面板里一开关就要立刻生效），所以设置必须由这里读、缓存，再交给
 * 网关一个布尔值。网关本身仍然只认「传进来的布尔值 + 请求里的凭证」，不回头读设置。
 */

import type { IncomingMessage } from 'node:http'
import type { AuthSession } from '@common/auth'
import type { Settings } from '@common/schemas'
import { getSettings, onSettingsChanged } from '../../database/settings-store'
import { hasAnyAccount } from '../../database/user-store'
import { getRequestSession, type SessionRecord } from './session-store'

/**
 * 设置里的开关缓存。
 *
 * 每一条 `/api/*` 请求都要读它，而 `getSettings()` 是一次 SQLite 查询。缓存由
 * `onSettingsChanged` 失效，主进程里改设置的那一刻就同步生效。
 *
 * 初始值取 `false`（fail-open）：服务刚起来、`getSettings()` 还没跑过时，「不知道」应当
 * 走与旧版本一致的行为，而不是把所有人挡在门外。真正的 fail-closed 来自界面：一台还没
 * 读到设置的服务器在毫秒级内就会被读到，而这段时间里它连监听都还没稳。
 */
let cachedEnabled: boolean | null = null
let unsubscribe: (() => void) | null = null

async function readEnabled(): Promise<boolean> {
  if (cachedEnabled !== null) return cachedEnabled
  const settings = await getSettings()
  cachedEnabled = settings.managementAuthEnabled
  unsubscribe ??= onSettingsChanged((next: Settings) => {
    cachedEnabled = next.managementAuthEnabled
  })
  return cachedEnabled
}

/** 测试用：把缓存打回未初始化。 */
export function resetAuthState(): void {
  cachedEnabled = null
  unsubscribe?.()
  unsubscribe = null
}

/**
 * 这台服务此刻要不要登录。
 *
 * 「要登录」必须同时满足「开关打开」与「库里至少有一个账号」，理由见文件头。
 */
export async function isAuthenticationRequired(): Promise<boolean> {
  if (!(await readEnabled())) return false
  return hasAnyAccount()
}

/**
 * 这条请求是不是已经通过了登录。
 *
 * 两种情况算通过：
 *
 *   1. 这台服务不要求登录（见 `isAuthenticationRequired`）；
 *   2. 请求带着一张有效会话。
 *
 * 启动凭证（`x-osw-token`）**不在这里**判断：它是网关那条路上的另一扇门，本函数只回答
 * 「浏览器这一侧过没过」。两边是「或」的关系，由 `gateway.ts` 拼起来——因为凭证的校验
 * 必须留在 `access.ts`（那条链路里唯一的门）。
 */
export async function isRequestAuthenticated(req: IncomingMessage): Promise<{ authenticated: boolean; session: SessionRecord | null }> {
  if (!(await isAuthenticationRequired())) return { authenticated: true, session: null }
  const session = getRequestSession(req)
  return { authenticated: session !== null, session }
}

/**
 * 给界面用的会话快照。
 *
 * 三个字段回答三个不同的问题（见 `@common/auth` 的 `AuthSessionSchema`）：这台服务要不要
 * 登录、这个浏览器过没过、库里有没有账号。合成一个字段的话，登录页就没法区分
 * 「口令错了」与「还没建账号」——而后者是首装时的**唯一**情况，用户会在一个永远登不进去
 * 的页面上反复试。
 */
export async function describeSession(req: IncomingMessage): Promise<AuthSession> {
  const required = await isAuthenticationRequired()
  const hasUsers = await hasAnyAccount()
  const session = required ? getRequestSession(req) : null
  return {
    required,
    // 不要求登录时也算「已通过」：界面据此完全跳过登录页。
    authenticated: required ? session !== null : true,
    hasUsers,
    username: session?.username ?? null,
    expiresTime: session?.expiresTime ?? null,
  }
}
