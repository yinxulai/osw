import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { generateKeyReference } from '@common/secret-store'
import { ProtocolSchema, ProviderSchema, type Provider } from '@common/schemas'
import {
  createProvider,
  deleteProvider as deleteProviderRecord,
  getProvider,
  listProviderEndpoints,
  listProviders,
  reorderProviders,
  replaceProviderEndpoints,
  updateProvider,
} from '@server/database/provider-store'
import { resetProviderHealth } from '@server/database/health-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { HttpRouter } from '@server/http-router'
import { exportProviderBundle } from '../../provider-transfer/export-provider-bundle'
import { importProviderBundle } from '../../provider-transfer/import-provider-bundle'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'

export const providerRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/provider/list', handleListProviders)
  .post('/api/provider/get', handleGetProvider)
  .post('/api/provider/endpoints', handleListProviderEndpoints)
  .post('/api/provider/create', handleCreateProvider)
  .post('/api/provider/update', handleUpdateProvider)
  .post('/api/provider/reorder', handleReorderProviders)
  .post('/api/provider/delete', handleDeleteProvider)
  .post('/api/provider/reset-health', handleResetProviderHealth)
  .post('/api/provider/export', handleExportProviderBundle)
  .post('/api/provider/import', handleImportProviderBundle)

/**
 * 列表默认只回活跃行；`includeDeleted` 连软删除的行一起回。
 *
 * 观测侧（请求日志、统计分析）的供应商名是**写入当时的快照**，删掉配置行不会让历史记录消失，
 * 但界面要能标出「这一家已经删了」。只比活跃名单做不到：被删的行仍在表里，正是靠这份全量
 * 名单才能把它认出来（见 `provider-store.deleteProvider`）。
 */
const ListProvidersSchema = z.object({ includeDeleted: z.boolean().optional() }).default({})
async function handleListProviders(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = ListProvidersSchema.parse(body)
  sendSuccess(res, await listProviders(input.includeDeleted ?? false))
}

const ReorderProvidersSchema = z.object({ ids: z.array(z.string().min(1)).min(1) })
async function handleReorderProviders(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { ids } = ReorderProvidersSchema.parse(body)
  sendSuccess(res, await reorderProviders(ids))
}

const GetProviderSchema = z.object({ id: z.string() })
async function handleGetProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetProviderSchema.parse(body)
  const provider = await getProvider(id)
  if (!provider) {
    sendError(res, 'NOT_FOUND', `Provider not found: ${id}`, 404, { providerId: id })
    return
  }
  sendSuccess(res, provider)
}

async function handleListProviderEndpoints(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetProviderSchema.parse(body)
  sendSuccess(res, await listProviderEndpoints(id))
}

const ProviderEndpointsSchema = z.record(ProtocolSchema, z.string().url())

const CreateProviderSchema = ProviderSchema.pick({
  name: true,
  timeoutMilliseconds: true,
  enabled: true,
})
  .extend({
    apiKey: z.string().trim().min(1).optional(),
    endpoints: ProviderEndpointsSchema.optional(),
  })
  .partial({ timeoutMilliseconds: true, enabled: true })

async function handleCreateProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateProviderSchema.parse(body)
  const apiKeyReference = generateKeyReference()
  const secretStore = getSecretStore()
  if (input.apiKey) await secretStore.set(apiKeyReference, input.apiKey)
  try {
    const provider = await createProvider({
      name: input.name,
      apiKeyReference,
      timeoutMilliseconds: input.timeoutMilliseconds ?? 30000,
      enabled: input.enabled ?? true,
    })
    await replaceProviderEndpoints(provider.id, input.endpoints ?? {})
    sendSuccess(res, provider)
  } catch (error) {
    await secretStore.delete(apiKeyReference)
    throw error
  }
}

const UpdateProviderSchema = ProviderSchema.pick({
  id: true,
  name: true,
  timeoutMilliseconds: true,
  enabled: true,
})
  .partial()
  .required({ id: true })
  .extend({
    apiKey: z.string().trim().min(1).optional(),
    endpoints: ProviderEndpointsSchema.optional(),
  })

async function handleUpdateProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id, apiKey, endpoints, ...updates } = UpdateProviderSchema.parse(body)
  const current = await getProvider(id)
  if (!current) {
    sendError(res, 'NOT_FOUND', `Provider not found: ${id}`, 404, { providerId: id })
    return
  }
  // 端点排在最前：它是唯一会被守卫拒绝的一步（见 `endpointUrlInUseError`），先写才不会在报错时
  // 留下「名字改了、地址没改」的半截状态。
  if (endpoints !== undefined) await replaceProviderEndpoints(id, endpoints)
  if (apiKey) await getSecretStore().set(current.apiKeyReference, apiKey)
  const mergedUpdates: Partial<Pick<Provider, 'name' | 'timeoutMilliseconds' | 'enabled'>> = { ...updates }
  const provider = await updateProvider(id, mergedUpdates)
  sendSuccess(res, provider)
}

const DeleteProviderSchema = z.object({ id: z.string() })
async function handleDeleteProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = DeleteProviderSchema.parse(body)
  await deleteProviderAndSecret(id)
  sendSuccess(res, { id })
}

export async function deleteProviderAndSecret(id: string): Promise<void> {
  const provider = await getProvider(id)
  await deleteProviderRecord(id)
  if (provider) await getSecretStore().delete(provider.apiKeyReference)
}

const ResetHealthSchema = z.object({ providerId: z.string() })
async function handleResetProviderHealth(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { providerId } = ResetHealthSchema.parse(body)
  await resetProviderHealth(providerId)
  sendSuccess(res, { providerId })
}

async function handleExportProviderBundle(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  sendSuccess(res, await exportProviderBundle(body))
}

async function handleImportProviderBundle(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  sendSuccess(res, await importProviderBundle(body))
}
