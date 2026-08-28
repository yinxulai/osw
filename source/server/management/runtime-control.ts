import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { getSettings } from '@server/database/settings-store'
import { listProviderHealth, listProviderModelHealth } from '@server/database/health-store'
import { getManualModel, setManualModel } from '../proxy/routing/manual-routing'
import {
  getProxyServerStatus,
  restartProxyServer,
  startProxyServer,
  stopProxyServer,
} from '../proxy/runtime/server'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import { HttpRouter } from '@server/http-router'

export const runtimeControlRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/queue/status', handleQueueStatus)
  .post('/api/queue/switch', handleQueueSwitch)
  .post('/api/health/list', handleListHealth)
  .post('/api/proxy/status', handleProxyStatus)
  .post('/api/proxy/start', handleProxyStart)
  .post('/api/proxy/stop', handleProxyStop)
  .post('/api/proxy/restart', handleProxyRestart)

const QueueStatusSchema = z.object({ logicalModelId: z.string().min(1) })
function handleQueueStatus(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { logicalModelId } = QueueStatusSchema.parse(body)
  sendSuccess(res, { logicalModelId, manualModelId: getManualModel(logicalModelId) })
}

const SwitchQueueSchema = z.object({ logicalModelId: z.string().min(1), modelId: z.string().nullable() })
function handleQueueSwitch(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { logicalModelId, modelId } = SwitchQueueSchema.parse(body)
  setManualModel(logicalModelId, modelId)
  sendSuccess(res, { logicalModelId, modelId })
}

async function handleListHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [providers, providerModels] = await Promise.all([listProviderHealth(), listProviderModelHealth()])
  sendSuccess(res, { providers, providerModels })
}

async function handleProxyStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await getProxyServerStatus())
}

async function handleProxyStart(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.log('[management] /api/proxy/start begin')
  await startProxyServer()
  const status = await getProxyServerStatus()
  console.log(`[management] /api/proxy/start success status=${JSON.stringify(status)}`)
  sendSuccess(res, status)
}

async function handleProxyStop(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.log('[management] /api/proxy/stop begin')
  await stopProxyServer()
  const status = await getProxyServerStatus()
  console.log(`[management] /api/proxy/stop success status=${JSON.stringify(status)}`)
  sendSuccess(res, status)
}

async function handleProxyRestart(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const settings = await getSettings()
  await restartProxyServer({ host: settings.listenHost, port: settings.listenPort })
  sendSuccess(res, await getProxyServerStatus())
}
