/**
 * 只在开发形态存在的路径。
 *
 * 只有一条：`/api/development/seed`——一键把界面喂成有数据的样子。门在**网关**
 * （`../gateway.ts`）而不是路由里：路由忘了判，生产实例就会被人一键灌满演示数据。
 *
 * 曾经这里还有一条 `POST /api/development/management-token`，让无头截图进程读出本次启动
 * 的凭证。凭证改成「无条件校验 + 数据目录里的 `0600` 文件交付」（见 `../token-file.ts`）
 * 之后它必须消失：任何「把凭证发给你」的接口，在全局校验之下都只能是绕过校验的后门
 * ——尤其它唯一能用的判据（请求里有没有浏览器痕迹）由调用方自己写。
 *
 * 从 2026-10 起开发形态本来就不校验凭证了（见 `./access.ts`），这个接口更没有必要存在。
 *
 * 为什么这条路径不各写一份环境判断：「生产形态下这条路径不存在」这件事只有一个答案，
 * 散成几处判断时，改一处就会漏一处。
 */

import type { ServerResponse } from 'node:http'
import { sendError } from '../core/response'

/** 造演示数据的路径。 */
const SEED_PATH = '/api/development/seed'

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
