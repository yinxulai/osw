/**
 * 管理面登录的契约。
 *
 * 这里只描述**形状**：账号、会话、以及登录/登出的请求正文。判断「这个请求能不能进 `/api/*`」
 * 的逻辑在 core（`management/gateway/access.ts`），口令怎么存（哈希参数、盐、会话 id 形态）
 * 在 core（`management/auth/`），两边都不该由界面来定义。
 *
 * 为什么单独一个文件而不是塞进 `schemas.ts`：`schemas.ts` 是「业务数据」的集合，而这一套是
 * **访问控制**的形状。访问控制的字段一旦和业务字段混在一起，下一次改「设置」的人会很容易
 * 顺手在这里加一个 `role`，然后把权限判断写进某个业务接口里——那正是 `gateway.ts` 文件头
 * 反复强调要避免的事（判据只能来自启动配置与凭证，不能散在路由里）。
 */

import { z } from 'zod'

/**
 * 口令的强度下限。
 *
 * 只卡长度，不卡字符种类：强制「必须有大写字母和符号」在真实世界里只会得到 `Password1!`
 * 这种同时满足规则又好猜的口令。长度是唯一与真实熵相关的一条。
 */
export const MANAGEMENT_PASSWORD_MIN_LENGTH = 8

export const ManagementUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'use letters, digits, dot, underscore or hyphen')

/**
 * 一个管理账号。**不含任何口令字段**：哈希只活在 core 的存储层里，响应里出现它
 * （哪怕是哈希）都只是给攻击者一份离线爆破的素材。
 */
export const ManagementUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  createdTime: z.number().int().nonnegative(),
  /** 最近一次成功登录的时间；从未登录过为 `null`。 */
  lastLoginTime: z.number().int().nonnegative().nullable(),
})
export type ManagementUser = z.infer<typeof ManagementUserSchema>

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  /**
   * 保持登录（把会话 cookie 从「浏览器会话期」改成带过期时间的持久 cookie）。
   *
   * 默认关：管理面板能改配置、能导出明文密钥，让它在一台共享机器的浏览器里
   * 一直有效，是「方便」换来的一个不该默认成立的结论。
   */
  remember: z.boolean().optional(),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

/**
 * 当前会话的应答，同时是**前端判断要不要渲染登录页**的唯一依据。
 *
 * `required` 与 `authenticated` 是两个问题，不能合并：
 *
 *   - `required` 是**这台服务**的配置（`managementAuthEnabled`，服务形态默认开）；
 *   - `authenticated` 是**这个浏览器**当下有没有有效会话。
 *
 * 关掉登录的环境里 `required: false, authenticated: true`——「不需要登录，且当作已通过」，
 * 界面据此完全跳过登录页，也不会去查一个永远不存在的账号。
 *
 * `hasUsers: false` 是首装状态：登录页要说的不是「口令错了」，而是「还没有账号，去终端
 * 跑 `osw user-add`」。把这两种情况混成一句 401，用户会在一个永远登不进去的页面上反复试。
 */
export const AuthSessionSchema = z.object({
  required: z.boolean(),
  authenticated: z.boolean(),
  hasUsers: z.boolean(),
  /** 已登录时的账号名；未登录为 `null`。 */
  username: z.string().nullable(),
  /** 已登录时该会话的过期时间（毫秒时间戳）；未登录为 `null`。 */
  expiresTime: z.number().int().nonnegative().nullable(),
})
export type AuthSession = z.infer<typeof AuthSessionSchema>
