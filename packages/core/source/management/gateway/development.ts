/**
 * 只在开发形态存在的路径。
 *
 * 这类路径有两个，形状不同但理由同一个：它们都是**为开发期服务**的旁路，正式形态下
 * 必须当作不存在。
 *
 *   - `/api/development/seed`：一键把界面喂成有数据的样子。门在**网关**（`../gateway.ts`）
 *     而不是路由里：路由忘了判，生产实例就会被人一键灌满演示数据。
 *   - `/api/development/management-token`：读出本次启动的凭证。它比上一条还多两道门
 *     （宿主确实生成了凭证、且只对非浏览器客户端应答），那两道在网关里与凭证校验一起判。
 *
 * 为什么两者都在这里而不是各写一份环境判断：「生产形态下这条路径不存在」这件事只有
 * 一个答案，散成几处判断时，改一处就会漏一处。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendError } from '../core/response'

/** 读出本次启动凭证的路径。`/development/` 前缀让它在日志与代码里一眼看出只属于开发形态。 */
export const DEVELOPMENT_TOKEN_PATH = '/api/development/management-token'

/** 造演示数据的路径。 */
const SEED_PATH = '/api/development/seed'

/**
 * 这条请求是不是在要凭证。
 *
 * 只做纯粹的匹配：环境判定与凭证校验都在网关里，这里不重复。GET / OPTIONS 一律
 * `false`——GET 在网关那层已经是 405，这里再放过一次就等于给了一条捞凭证的路。
 */
export function isDevelopmentTokenRequest(req: IncomingMessage): boolean {
  if (req.method !== 'POST') return false
  return new URL(req.url ?? '/', 'http://localhost').pathname === DEVELOPMENT_TOKEN_PATH
}

/**
 * 这条路径是否只在开发形态存在。
 *
 * **完整路径**比对，不做前缀匹配：`/api/development/seed/` 是另一条路径（它不存在，
 * 路由会给 404），把它也算进来只会让门禁顺手盖住一个本该由路由回答的问题。
 */
export function isDevelopmentOnlyPath(pathname: string): boolean {
  return pathname === SEED_PATH
}

/**
 * 正式形态下把开发路径当作不存在。
 *
 * 用 `404` 而不是 `403`：`403` 等于向调用方确认「这条路径存在，只是不给你用」。
 */
export function rejectDevelopmentOnlyPath(res: ServerResponse, pathname: string): void {
  sendError(res, 'NOT_FOUND', `API path not found: ${pathname}`, 404, { path: pathname })
}
