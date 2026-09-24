import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  ClientConfigApplyRequestSchema,
  ClientConfigFileRequestSchema,
  ClientConfigFillRequestSchema,
  ClientConfigOverviewRequestSchema,
  ClientConfigSaveRequestSchema,
  ClientConfigVersionRequestSchema,
  ClientConfigVersionRestoreRequestSchema,
} from '@common/client-config'
import { HttpRouter } from '@server/http-router'
import {
  applyClientConfigDefaults,
  applyClientConfigOverrides,
  listClientConfigFileVersions,
  listClientConfigOverview,
  readClientConfigFile,
  readClientConfigVersion,
  restoreClientConfigVersion,
  saveClientConfigContent,
} from '@server/client-config/service'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

/**
 * 客户端配置读写。
 *
 * 全部是 POST：这几个入口都会动用户的磁盘文件，而管理 API 的约定就是「只认 POST /api/*」
 * （见 `core/request-guards.ts`），顺带避开浏览器对 GET 的预取/CORS 简化请求。
 *
 * 路径与客户端 key 的合法性校验在 service 里（`resolveClientConfigTarget`）——
 * 注册表只有 core 与 console 共享，把「哪些文件可写」这件事放在路由层会让规则有两份。
 */
export const clientConfigRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/client-config/get', handleGetFile)
  .post('/api/client-config/overview', handleOverview)
  .post('/api/client-config/apply', handleApply)
  .post('/api/client-config/fill', handleFill)
  .post('/api/client-config/save', handleSave)
  .post('/api/client-config/versions', handleListVersions)
  .post('/api/client-config/version/get', handleGetVersion)
  .post('/api/client-config/version/restore', handleRestoreVersion)

async function handleGetFile(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { clientKey, filePath } = ClientConfigFileRequestSchema.parse(body)
  sendSuccess(res, await readClientConfigFile(clientKey, filePath))
}

/** 列表页的一屏数据：每个客户端的状态、最近修改时间与版本数。 */
async function handleOverview(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  ClientConfigOverviewRequestSchema.parse(body)
  sendSuccess(res, await listClientConfigOverview())
}

/**
 * 一键生效。
 *
 * 带 `clientKey` 的是列表行内那颗按钮，不带的是页面右上角那颗——同一套默认值、
 * 同一条写入路径，返回的也是同一种结果，界面按客户端逐行汇报。
 */
async function handleFill(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { clientKey } = ClientConfigFillRequestSchema.parse(body)
  sendSuccess(res, await applyClientConfigDefaults(clientKey))
}

async function handleApply(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { clientKey, filePath, model, smallModel } = ClientConfigApplyRequestSchema.parse(body)
  sendSuccess(res, await applyClientConfigOverrides(clientKey, filePath, { model, smallModel }))
}

async function handleSave(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { clientKey, filePath, content, note } = ClientConfigSaveRequestSchema.parse(body)
  sendSuccess(res, await saveClientConfigContent(clientKey, filePath, content, note))
}

async function handleListVersions(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { clientKey, filePath } = ClientConfigFileRequestSchema.parse(body)
  sendSuccess(res, listClientConfigFileVersions(clientKey, filePath))
}

async function handleGetVersion(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = ClientConfigVersionRequestSchema.parse(body)
  // 读不到就是 null，交给界面显示「这个版本已经不在了」：历史被清空是正常状态，不是错误。
  sendSuccess(res, readClientConfigVersion(id))
}

async function handleRestoreVersion(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { clientKey, filePath, id } = ClientConfigVersionRestoreRequestSchema.parse(body)
  sendSuccess(res, await restoreClientConfigVersion(clientKey, filePath, id))
}
