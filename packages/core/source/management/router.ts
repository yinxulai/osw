/**
 * 管理 API 的路由表。
 *
 * 它只做一件半事：按下发的 `method + pathname` 找处理器、解析正文、把异常翻译成响应。
 *
 * 「这请求有没有资格进来」不归它管——路径、方法、凭证、开发路径的环境判定都在
 * `./gateway.ts`。以前这里还夹着一层环境门禁（`/api/development/seed` 在正式形态回 404），
 * 那是把一条**访问**规则藏在一条**分发**规则里：读 `router.ts` 的人不会想到自己正在看
 * 安全边界，而改网关的人也不会想到还有第二处在判环境。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ManagementHandler } from './core/response'
import { sendError } from './core/response'
import {
  analyticsRoutes,
  clientConfigRoutes,
  cloudSyncRoutes,
  developmentRoutes,
  logRoutes,
  modelConnectivityRoutes,
  modelRoutes,
  outboundProxyTestRoutes,
  providerModelFetchRoutes,
  routerGraphRoutes,
  routerRuleRoutes,
  routerRunRoutes,
  providerModelRoutes,
  providerRoutes,
  relationRoutes,
  requestLogRoutes,
  requestRewriteRuleRoutes,
  runtimeControlRoutes,
  settingsRoutes,
  storageRoutes,
  taskRoutes,
  telemetryRoutes,
} from './routes'
import { parseJsonBody } from './core/request-body'
import { handleApiError } from './core/error-handler'
import { HttpRouter } from '@server/http-router'

const router = new HttpRouter<ManagementHandler>()
  .mount(providerRoutes)
  .mount(modelRoutes)
  .mount(providerModelRoutes)
  .mount(settingsRoutes)
  .mount(runtimeControlRoutes)
  .mount(telemetryRoutes)
  .mount(logRoutes)
  .mount(requestLogRoutes)
  .mount(analyticsRoutes)
  .mount(modelConnectivityRoutes)
  .mount(outboundProxyTestRoutes)
  .mount(providerModelFetchRoutes)
  .mount(routerGraphRoutes)
  .mount(routerRuleRoutes)
  .mount(routerRunRoutes)
  .mount(relationRoutes)
  .mount(requestRewriteRuleRoutes)
  .mount(developmentRoutes)
  .mount(storageRoutes)
  .mount(clientConfigRoutes)
  .mount(cloudSyncRoutes)
  .mount(taskRoutes)

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, 'http://localhost')
  const route = router.match(req.method, url.pathname)

  if (!route) {
    sendError(res, 'NOT_FOUND', `API path not found: ${url.pathname}`, 404, { path: url.pathname })
    return
  }

  try {
    const body = await parseJsonBody(req)
    await route.handler(req, res, body)
  } catch (error) {
    handleApiError(req, res, error)
  }
}
