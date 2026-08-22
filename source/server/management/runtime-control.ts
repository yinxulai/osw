import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { listProviderHealth, listProviderModelHealth } from '../database/health-store'
import { getManualModel, setManualModel } from '../proxy/manual-routing'
import {
  getProxyServerStatus,
  restartProxyServer,
  startProxyServer,
  stopProxyServer,
} from '../proxy/server'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'

export const runtimeControlRoutes: Record<string, ManagementHandler> = {
  '/api/queue/status': handleQueueStatus,
  '/api/queue/switch': handleQueueSwitch,
  '/api/health/list': handleListHealth,
  '/api/proxy/status': handleProxyStatus,
  '/api/proxy/start': handleProxyStart,
  '/api/proxy/stop': handleProxyStop,
  '/api/proxy/restart': handleProxyRestart,
}

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
  await startProxyServer()
  sendSuccess(res, await getProxyServerStatus())
}

async function handleProxyStop(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  await stopProxyServer()
  sendSuccess(res, await getProxyServerStatus())
}

async function handleProxyRestart(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  await restartProxyServer()
  sendSuccess(res, await getProxyServerStatus())
}
