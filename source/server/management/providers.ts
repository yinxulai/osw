import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { generateKeyReference } from '@common/keychain'
import { ProtocolSchema, ProviderSchema, type Provider } from '@common/schemas'
import {
  createProvider,
  deleteProvider as deleteProviderRecord,
  getProvider,
  listProviderEndpoints,
  listProviders,
  replaceProviderEndpoints,
  resetProviderHealth,
  updateProvider,
} from '../database/store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'

export const providerRoutes: Record<string, ManagementHandler> = {
  '/api/provider/list': handleListProviders,
  '/api/provider/get': handleGetProvider,
  '/api/provider/endpoints': handleListProviderEndpoints,
  '/api/provider/create': handleCreateProvider,
  '/api/provider/update': handleUpdateProvider,
  '/api/provider/delete': handleDeleteProvider,
  '/api/provider/reset-health': handleResetProviderHealth,
}

async function handleListProviders(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await listProviders())
}

const GetProviderSchema = z.object({ id: z.string() })
async function handleGetProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetProviderSchema.parse(body)
  const provider = await getProvider(id)
  if (!provider) {
    sendError(res, 'NOT_FOUND', 'Provider 不存在', 404)
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
    sendError(res, 'NOT_FOUND', 'Provider 不存在', 404)
    return
  }
  if (apiKey) await getSecretStore().set(current.apiKeyReference, apiKey)
  const mergedUpdates: Partial<Pick<Provider, 'name' | 'timeoutMilliseconds' | 'enabled'>> = { ...updates }
  const provider = await updateProvider(id, mergedUpdates)
  if (endpoints !== undefined) await replaceProviderEndpoints(id, endpoints)
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
