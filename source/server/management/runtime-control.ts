import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { listProviderHealth } from '../database/store'
import { getManualBinding, setManualBinding } from '../proxy/handler'
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

function handleQueueStatus(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, { manualBindingId: getManualBinding() })
}

const SwitchQueueSchema = z.object({ bindingId: z.string().nullable() })
function handleQueueSwitch(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { bindingId } = SwitchQueueSchema.parse(body)
  setManualBinding(bindingId)
  sendSuccess(res, { bindingId })
}

async function handleListHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await listProviderHealth())
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
