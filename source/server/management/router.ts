import type { IncomingMessage, ServerResponse } from 'node:http'
import { modelRoutes } from './models'
import { providerRoutes } from './providers'
import type { ManagementHandler } from './response'
import { sendError } from './response'
import { runtimeControlRoutes } from './runtime-control'
import { settingsRoutes } from './settings'
import { providerModelRoutes } from './provider-models'
import { logRoutes } from './logs'
import { requestLogRoutes } from './request-logs'
import { analyticsRoutes } from './analytics'
import { configRoutes } from './config/routes'
import { modelTestRoutes } from './model-test'
import { providerModelFetchRoutes } from './provider-models-fetch'
import { relationRoutes } from './relations'
import { requestRewriteRuleRoutes } from './request-rewrite-rules'
import type { RuntimeEnvironment } from '@common/runtime-profile'
import { parseJsonBody } from './request-body'
import { handleApiError } from './error-handler'
import { isManagementPathAllowed, rejectDisallowedEnvironmentPath } from './environment-guard'
import { HttpRouter } from '../http-router'

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
    sendError(res, 'NOT_FOUND', `API 路径不存在: ${url.pathname}`, 404)
    return
  }

  try {
    const body = await parseJsonBody(req)
    await route.handler(req, res, body)
  } catch (error) {
    handleApiError(req, res, error)
  }
}
