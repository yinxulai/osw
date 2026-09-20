import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ManagementHandler } from './core/response'
import { sendError } from './core/response'
import {
  analyticsRoutes,
  developmentRoutes,
  logRoutes,
  modelRoutes,
  modelTestRoutes,
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
  telemetryRoutes,
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
  .mount(telemetryRoutes)
  .mount(logRoutes)
  .mount(requestLogRoutes)
  .mount(analyticsRoutes)
  .mount(modelTestRoutes)
  .mount(outboundProxyTestRoutes)
  .mount(providerModelFetchRoutes)
  .mount(routerGraphRoutes)
  .mount(routerRuleRoutes)
  .mount(routerRunRoutes)
  .mount(relationRoutes)
  .mount(requestRewriteRuleRoutes)
  .mount(developmentRoutes)
  .mount(storageRoutes)

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, environment: RuntimeEnvironment = 'production'): Promise<void> {
  const url = new URL(req.url!, 'http://localhost')
  if (!isManagementPathAllowed(url.pathname, environment)) {
    rejectDisallowedEnvironmentPath(res, url.pathname)
    return
  }

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
