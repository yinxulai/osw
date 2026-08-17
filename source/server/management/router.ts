import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { modelRoutes } from './models'
import { providerRoutes } from './providers'
import type { ManagementHandler } from './response'
import { sendError } from './response'
import { runtimeControlRoutes } from './runtime-control'
import { settingsRoutes } from './settings'
import { upstreamModelRoutes } from './bindings'
import { logRoutes } from './logs'
import { requestLogRoutes } from './request-logs'
import { analyticsRoutes } from './analytics'
import { configRoutes } from './config'

const routes: Record<string, ManagementHandler> = {
  ...providerRoutes,
  ...modelRoutes,
  ...upstreamModelRoutes,
  ...settingsRoutes,
  ...runtimeControlRoutes,
  ...logRoutes,
  ...requestLogRoutes,
  ...analyticsRoutes,
  ...configRoutes,
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, 'http://localhost')
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
      sendError(res, 'INTERNAL_ERROR', (error as Error).message, 500)
    }
  }
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
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
    req.on('error', reject)
  })
}
