import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
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
import { configRoutes } from './config'
import { modelTestRoutes } from './model-test'
import { providerModelFetchRoutes } from './provider-models-fetch'
import { relationRoutes } from './relations'
import type { RuntimeEnvironment } from '@common/runtime-profile'

const routes: Record<string, ManagementHandler> = {
  ...providerRoutes,
  ...modelRoutes,
  ...providerModelRoutes,
  ...settingsRoutes,
  ...runtimeControlRoutes,
  ...logRoutes,
  ...requestLogRoutes,
  ...analyticsRoutes,
  ...configRoutes,
  ...modelTestRoutes,
  ...providerModelFetchRoutes,
  ...relationRoutes,
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, environment: RuntimeEnvironment = 'production'): Promise<void> {
  const url = new URL(req.url!, 'http://localhost')
  if (url.pathname === '/api/config/seed-development' && environment !== 'development') {
    sendError(res, 'NOT_FOUND', `API 路径不存在: ${url.pathname}`, 404)
    return
  }
  const handler = routes[url.pathname]

  if (!handler) {
    sendError(res, 'NOT_FOUND', `API 路径不存在: ${url.pathname}`, 404)
    return
  }

  try {
    const body = await parseJsonBody(req)
    await handler(req, res, body)
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, 'VALIDATION_ERROR', error.errors.map(issue => issue.message).join('; '), 400)
    } else {
      const message = error instanceof Error ? error.message : String(error)
      sendError(res, 'INTERNAL_ERROR', message, 500)
    }
  }
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', chunk => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('aborted', () => fail(new Error('CLIENT_REQUEST_ABORTED')))
    req.on('error', error => fail(error))
  })
}
