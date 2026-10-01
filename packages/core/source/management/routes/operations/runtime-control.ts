import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { getLogicalModel } from '@server/database/logical-model-store'
import { getProviderModel } from '@server/database/model-store'
import { getProvider } from '@server/database/provider-store'
import { getSettings } from '@server/database/settings-store'
import { listProviderHealth, listProviderModelHealth } from '@server/database/health-store'
import { getManualModel, setManualModel } from '../../../proxy/routing/manual-routing'
import {
  getProxyServerStatus,
  restartProxyServer,
  startProxyServer,
  stopProxyServer,
} from '../../../proxy/runtime/server'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { getShutdownHandshake } from '../../core/shutdown-handshake'
import { HttpRouter } from '@server/http-router'

export const runtimeControlRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/logical-model/status', handleLogicalModelStatus)
  .post('/api/logical-model/switch', handleLogicalModelSwitch)
  .post('/api/health/list', handleListHealth)
  .post('/api/proxy/status', handleProxyStatus)
  .post('/api/proxy/start', handleProxyStart)
  .post('/api/proxy/stop', handleProxyStop)
  .post('/api/proxy/restart', handleProxyRestart)
  .post('/api/runtime/shutdown', handleRuntimeShutdown)

const LogicalModelStatusSchema = z.object({ logicalModelId: z.string().min(1) })
function handleLogicalModelStatus(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { logicalModelId } = LogicalModelStatusSchema.parse(body)
  sendSuccess(res, { logicalModelId, manualModelId: getManualModel(logicalModelId) })
}

const SwitchLogicalModelSchema = z.object({ logicalModelId: z.string().min(1), modelId: z.string().nullable() })
async function handleLogicalModelSwitch(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { logicalModelId, modelId } = SwitchLogicalModelSchema.parse(body)
  setManualModel(logicalModelId, modelId)
  // 这行日志是给人排查「我刚才在界面上把 A 切到 B 了」的，因此写名字而不是记录 id：
  // id 只有对着数据库才认得出来，而这里已经能读到名字。查不到时回落成 id，别把事实吞掉。
  const [logicalModel, providerModel] = await Promise.all([
    getLogicalModel(logicalModelId),
    modelId === null ? Promise.resolve(undefined) : getProviderModel(modelId),
  ])
  const provider = providerModel === undefined ? undefined : await getProvider(providerModel.providerId)
  console.info(`[management] manual route updated logicalModelId=${logicalModelId} model=${logicalModel?.modelId ?? logicalModelId} target=${providerModel === undefined ? 'automatic' : `${provider?.name ?? providerModel.providerId}/${providerModel.modelName}`}`)
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
  console.info('[management] proxy start requested')
  await startProxyServer()
  const status = await getProxyServerStatus()
  console.info(`[management] proxy start completed host=${status.host} port=${status.port} running=${status.running}`)
  sendSuccess(res, status)
}

async function handleProxyStop(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.info('[management] proxy stop requested')
  await stopProxyServer()
  const status = await getProxyServerStatus()
  console.info(`[management] proxy stop completed host=${status.host} port=${status.port} running=${status.running}`)
  sendSuccess(res, status)
}

async function handleProxyRestart(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.info('[management] proxy restart requested')
  const settings = await getSettings()
  await restartProxyServer({ host: settings.listenHost, port: settings.listenPort })
  const status = await getProxyServerStatus()
  console.info(`[management] proxy restart completed host=${status.host} port=${status.port} running=${status.running}`)
  sendSuccess(res, status)
}

/**
 * 请求宿主优雅退出。
 *
 * 端点只在宿主显式配置了握手时存在（CLI 会配，桌面形态不会）。**这里不做身份校验**：
 * 本版本的管理 API 没有凭证，`/api/*` 的边界只有回环监听与 CORS
 *（见 `../../core/request-guards.ts`），这里只回答「本次宿主允许被停掉吗」。
 */
function handleRuntimeShutdown(_req: IncomingMessage, res: ServerResponse): void {
  const handshake = getShutdownHandshake()
  if (!handshake) {
    sendError(res, 'RESOURCE_NOT_FOUND', 'Runtime shutdown endpoint is not enabled', 404)
    return
  }

  console.info('[management] runtime shutdown accepted')
  // 先把响应写回去再触发停止：宿主一收尾就会关掉监听，不能让自己的响应被一起掐掉。
  res.once('finish', () => handshake.onRequest())
  sendSuccess(res, { stopping: true })
}
