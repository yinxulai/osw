import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ManagementHandler } from './core/response'
import { sendError } from './core/response'
import {
  analyticsRoutes,
  configRoutes,
  logRoutes,
  modelRoutes,
  modelTestRoutes,
  providerModelFetchRoutes,
  providerModelRoutes,
  providerRoutes,
  relationRoutes,
  requestLogRoutes,
  requestRewriteRuleRoutes,
  runtimeControlRoutes,
  settingsRoutes,
} from './routes'
import type { RuntimeEnvironment } from '@common/runtime-profile'
import { parseJsonBody } from './core/request-body'
import { handleApiError } from './core/error-handler'
import { isManagementPathAllowed, rejectDisallowedEnvironmentPath } from './core/environment-guard'
import { HttpRouter } from '@server/http-router'

const router = new HttpRouter<ManagementHandler>()
  .mount(providerRoutes)
  .mount(modelRoutes)
  .mount(providerModelRoutes)
  .mount(settingsRoutes)
  .mount(runtimeControlRoutes)
  .mount(logRoutes)
  .mount(requestLogRoutes)
  .mount(analyticsRoutes)
  .mount(configRoutes)
  .mount(modelTestRoutes)
  .mount(providerModelFetchRoutes)
  .mount(relationRoutes)
  .mount(requestRewriteRuleRoutes)

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, environment: RuntimeEnvironment = 'production'): Promise<void> {
  const url = new URL(req.url!, 'http://localhost')
  if (!isManagementPathAllowed(url.pathname, environment)) {
    rejectDisallowedEnvironmentPath(res, url.pathname)
    return
  }

  const route = router.match(req.method, url.pathname)

  if (!route) {
    sendError(res, 'NOT_FOUND', `API 路径不存在 ${url.pathname}`, 404)
    return
  }

  try {
    const body = await parseJsonBody(req)
    await route.handler(req, res, body)
  } catch (error) {
    handleApiError(req, res, error)
  }
}
