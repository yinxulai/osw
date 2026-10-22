/**
 * 管理网关：管理端口上**每一条**请求的唯一入口。
 *
 * 这里只有一个概念要维护：**这条请求归谁处理**。之前它散在 `server.ts` 的四段 `if`、
 * `gateway/access.ts`、`gateway/console-host.ts`、`gateway/development.ts` 与 `router.ts`
 * 里，改一处边界要想清楚另外四处的顺序；现在顺序就是下面那张表，从上往下读一遍就知道
 * 一条请求会经过什么。
 *
 * ## 顺序（不可重排）
 *
 * | # | 判据 | 谁应答 | 为什么必须在这一位 |
 * |---|------|--------|--------------------|
 * | 1 | 非 `GET`/`HEAD` 或 `/api*` | 谁都不应答 → 往下走 | 静态托管与 API 是两个不相交的域，先分流省掉后面每一步 |
 * | 2 | 静态文件命中 | 控制台产物 | SPA 回退要拿到**未被改写过的**请求，所以它在所有门之前 |
 * | 3 | `OPTIONS` | CORS 预检 204 | 预检是浏览器自己发的，不该被要求带凭证 |
 * | 4 | 非 `/api/`、非 `POST` | 404 / 405 | 对不存在的路径回 `401` 等于用状态码确认「凭证不对」，语义倒置 |
 * | 5 | 凭证不对 | 401 | 唯一的门，**没有例外**，见 `./gateway/access.ts` |
 * | 6 | 正式形态的 `/api/development/seed` | 404 | 开发路径在正式形态必须**不存在**，不能靠路由自己记得判 |
 * | 7 | 其它 `/api/*` | 路由 | 到这里请求一定合规，剩下的是业务 |
 *
 * 注意 3 在 2 之后：静态托管只接 `GET`/`HEAD`，`OPTIONS` 走不到它，两者互不干扰，
 * 但把静态放前面是为了让「页面从自己的端口加载」这条路径一条门都不经过。
 *
 * ## 配置只有一处
 *
 * `ManagementGatewayOptions` 是本文件唯一的输入，三个字段决定上表里哪几步生效：
 *
 *   - `webRoot`：不给就没有第 2 步（桌面形态自己 `loadFile`）。
 *   - `token`：本次启动的凭证。不给时第 5 步**仍然生效**——所有 `/api/*` 一律被挡
 *     （见 `./gateway/access.ts` 的 `hasValidToken`），因为「宿主忘了传」是配置异常，
 *     不该让一个漏配的环境静默变成对本机任何进程可写的环境。
 *   - `environment`：决定第 6 步是否存在。
 *
 * 之前这三件事各自在模块级闭包里被读一次，于是「这次启动到底开了哪些门」要跨六个文件
 * 拼出来。现在它们只在 `createManagementGateway` 里读一次。
 */

import { checkApiAccess } from './gateway/access'
import { createConsoleHost, type ConsoleHost } from './gateway/console-host'
import { isDevelopmentOnlyPath, rejectDevelopmentOnlyPath } from './gateway/development'
import { handleApiRequest } from './router'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RuntimeEnvironment } from '@common/runtime-profile'

export interface ManagementGatewayOptions {
  /**
   * 控制台静态产物根目录。给了才托管；桌面形态自己 `loadFile`，不走这里。
   * 路径由宿主决定，core 不猜（见 `apps/docs/specs/packaging.md` §5.2）。
   */
  webRoot?: string | null
  /**
   * 本次应用启动的管理 API 凭证。给了就强制校验，并注入进托管的入口页面。
   * 不给时所有 `/api/*` 一律 `401`（fail-closed），没有任何例外。
   */
  token?: string | null
  /** 运行形态。只有开发专用路径看它，见 `./gateway/development.ts`。 */
  environment?: RuntimeEnvironment
}

/** 一条请求最终落到了哪一步。只用于日志分级，不参与行为。 */
export type GatewayOutcome =
  /** 静态产物已发出。 */
  | 'console'
  /** 预检、路径、方法或凭证没过（`access.ts` 已经应答）。 */
  | 'rejected'
  /** 正式形态下被当作不存在的开发路径。 */
  | 'development-path'
  /** 走到了路由。 */
  | 'api'

export interface ManagementGateway {
  /** 静态产物根目录，没托管时为 `null`。启动日志要用它。 */
  readonly consoleRoot: string | null
  /**
   * 处理一条请求。
   *
   * **一定**会写出响应（或掐掉连接），调用方拿到返回值时不必再做什么。异常只在
   * 「写不下去」这种边界情形下抛出，那种情况由 `./server.ts` 决定是回错误还是挂断。
   *
   * 返回值是这条请求落到了哪一步，供日志分级；调用方不靠它决定后续动作——没有后续了。
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<GatewayOutcome>
}

export function createManagementGateway(options: ManagementGatewayOptions = {}): ManagementGateway {
  const token = options.token ?? null
  const environment = options.environment ?? 'production'
  const isDevelopment = environment === 'development'
  const consoleHost: ConsoleHost | null = options.webRoot ? createConsoleHost(options.webRoot, token) : null

  return {
    consoleRoot: consoleHost?.root ?? null,

    async handle(req, res) {
      // 1 + 2：静态托管先分流。它自己会判方法与非 `/api` 路径，命中就整条请求结束了。
      if (consoleHost && await consoleHost.handle(req, res)) return 'console'

      // 3 + 4 + 5：CORS、预检、路径、方法、凭证。
      const access = checkApiAccess(req, res, token)
      if (!access.accepted) return 'rejected'

      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

      // 6：开发路径在正式形态下必须不存在。放在凭证之后、路由之前——
      // 凭证先判，是因为「有资格问」比「这条路径存在吗」更靠前。
      if (!isDevelopment && isDevelopmentOnlyPath(pathname)) {
        rejectDevelopmentOnlyPath(res, pathname)
        return 'development-path'
      }

      // 7：业务路由。
      await handleApiRequest(req, res)
      return 'api'
    },
  }
}
