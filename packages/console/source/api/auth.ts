/**
 * 登录相关的 API。
 *
 * 与其它模块（`runtime.ts`、`providers.ts` …）分开一个文件，是因为它们回答的问题不同：
 * 别的模块读写业务数据，这一组读写**访问权**。混在一起时，下一个改设置的人很容易顺手
 * 在这里加一个「当前用户能不能改设置」的判断——那属于 core 的门，不属于界面的模块。
 *
 * 全部是 `POST`，和其余管理接口一样（见 `apps/docs/specs/platform/packaging.md` §5.4）：
 * `GET /api/auth/session` 在这里不存在，也不该存在。
 */

import type { AuthSession, LoginRequest } from '@common/auth'
import type { ManagementUser } from '@common/auth'
import { request } from './client'

export const authApi = {
  /**
   * 当前会话。
   *
   * 这是**唯一**一个必须在未登录时也能调通的接口，core 把它放进了公开路径名单
   * （见 `packages/core/source/management/gateway.ts` 的 `PUBLIC_API_PATHS`）。
   */
  session: () => request<AuthSession>('/auth/session'),
  login: (input: LoginRequest) => request<AuthSession>('/auth/login', input),
  /** 登出回的是登出**之后**的会话（`authenticated: false`），不是一句 ack：界面直接拿它渲染。 */
  logout: () => request<AuthSession>('/auth/logout'),
  createAccount: (username: string, password: string) => request<ManagementUser>('/auth/account/create', { username, password }),
  listAccounts: () => request<ManagementUser[]>('/auth/account/list'),
  deleteAccount: (id: string) => request<ManagementUser[]>('/auth/account/delete', { id }),
  changePassword: (id: string, password: string) => request<ManagementUser[]>('/auth/account/password', { id, password }),
}
