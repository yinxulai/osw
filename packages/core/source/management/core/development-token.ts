/**
 * 开发形态下的凭证读取口：`POST /api/development/management-token`。
 *
 * **它存在的唯一理由是「截图」**（`apps/app/source/screenshot-export-entry.ts`）：那个入口
 * 是一个独立的 Electron 进程，没有自己的管理服务，只能去连**已经跑着的那个开发实例**；
 * 而凭证只活在那个实例的内存里（见 `../token.ts`），进程之间拿不到。于是页面会 401、
 * 截出来的全是空状态。
 *
 * 边界有三条，缺一条这个模块就不该存在：
 *
 *   1. **只在开发形态注册**。门在 `../server.ts`：`environment !== 'development'` 时这条
 *      判断根本不执行，请求继续往路由走，命中不了任何处理器就是 404。不是靠这个模块
 *      自己再写一遍环境判断。
 *   2. **只有非浏览器客户端读得到**。靠的是 `./request-guards.ts` 那条现成判据：带
 *      `Origin` / `Sec-Fetch-*` 的请求必须凭证对得上，而没有凭证的网页正是要挡的东西。
 *      所以网页读不走它；读得走它的本机进程，本来就能读数据目录与密钥。
 *   3. **不落盘、不进日志**。响应体是唯一出口，也没有任何写文件的路径。
 *
 * 正式形态**不要**「顺手」打开它：把凭证交出去等于把这次启动的边界作废。正式形态要
 * 数据就走用户自己的界面。
 */

import type { IncomingMessage } from 'node:http'

/** 读取凭证的路径。带 `/development/` 前缀是为了在日志与代码里一眼看出它只属于开发形态。 */
export const DEVELOPMENT_TOKEN_PATH = '/api/development/management-token'

/**
 * 这条请求是不是在要凭证。
 *
 * 只做纯粹的匹配：环境判定归 `../server.ts`，凭证校验归 `./request-guards.ts`。
 * 三件事各在各该在的地方，改其中一件不会顺手改坏另外两件。
 */
export function isDevelopmentTokenRequest(req: IncomingMessage): boolean {
  if (req.method !== 'POST') return false
  return new URL(req.url ?? '/', 'http://localhost').pathname === DEVELOPMENT_TOKEN_PATH
}
