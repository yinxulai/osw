import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { listProviderModelRoutesByProvider } from '@server/database/model-store'
import { listProviders } from '@server/database/provider-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { HttpRouter } from '@server/http-router'
import { listFreeModelSources } from '@server/free-models/registry'
import {
  findManagedProvider,
  getSourceSyncState,
  removeManagedProvider,
  syncFreeModelSource,
} from '@server/free-models/sync-engine'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'

export const freeModelRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/free-model/sources', handleListSources)
  .post('/api/free-model/enable', handleEnable)
  .post('/api/free-model/disable', handleDisable)
  .post('/api/free-model/sync', handleSync)
  .post('/api/free-model/update-key', handleUpdateKey)

async function handleListSources(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sources = listFreeModelSources()
  const result = await Promise.all(sources.map(async source => {
    const managed = await findManagedProvider(source.key)
    let modelCount = 0
    let syncState = null
    let providerEnabled = false
    if (managed) {
      const routes = await listProviderModelRoutesByProvider(managed.id, false)
      modelCount = routes.length
      syncState = await getSourceSyncState(managed.id)
      providerEnabled = (await listProviders(false)).some(provider => provider.id === managed.id && provider.enabled)
    }
    return {
      key: source.key,
      name: source.name,
      description: source.description,
      presetKey: source.presetKey,
      providerName: source.providerName,
      requiresApiKey: source.requiresApiKey,
      apiKeyPlaceholder: source.apiKeyPlaceholder ?? null,
      apiKeyHelpText: source.apiKeyHelpText ?? null,
      enabled: managed !== null,
      providerId: managed?.id ?? null,
      providerEnabled,
      modelCount,
      syncState,
    }
  }))
  sendSuccess(res, { sources: result })
}

const EnableSchema = z.object({
  sourceKey: z.string().min(1),
  apiKey: z.string().trim().optional(),
})

async function handleEnable(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = EnableSchema.parse(body)
  const source = listFreeModelSources().find(candidate => candidate.key === input.sourceKey)
  if (!source) {
    sendError(res, 'NOT_FOUND', '未知的免费模型源', 404)
    return
  }
  if (source.requiresApiKey && !input.apiKey) {
    const managed = await findManagedProvider(source.key)
    let hasExistingKey = false
    if (managed) {
      const provider = (await listProviders(true)).find(candidate => candidate.id === managed.id)
      if (provider) hasExistingKey = Boolean(await getSecretStore().get(provider.apiKeyReference))
    }
    if (!hasExistingKey) {
      sendError(res, 'VALIDATION_ERROR', '该免费模型源需要 API Key', 400)
      return
    }
  }
  const result = await syncFreeModelSource(source.key, { apiKey: input.apiKey })
  sendSuccess(res, result)
}

const SourceKeySchema = z.object({ sourceKey: z.string().min(1) })

async function handleDisable(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { sourceKey } = SourceKeySchema.parse(body)
  await removeManagedProvider(sourceKey)
  sendSuccess(res, { sourceKey })
}

async function handleSync(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { sourceKey } = SourceKeySchema.parse(body)
  const managed = await findManagedProvider(sourceKey)
  if (!managed) {
    sendError(res, 'VALIDATION_ERROR', '该免费模型源尚未启用', 400)
    return
  }
  const result = await syncFreeModelSource(sourceKey)
  sendSuccess(res, result)
}

const UpdateKeySchema = z.object({
  sourceKey: z.string().min(1),
  apiKey: z.string().trim().min(1),
})

async function handleUpdateKey(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = UpdateKeySchema.parse(body)
  const managed = await findManagedProvider(input.sourceKey)
  if (!managed) {
    sendError(res, 'VALIDATION_ERROR', '该免费模型源尚未启用', 400)
    return
  }
  const result = await syncFreeModelSource(input.sourceKey, { apiKey: input.apiKey })
  sendSuccess(res, result)
}
