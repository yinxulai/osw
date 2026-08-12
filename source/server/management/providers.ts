import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { generateKeyReference } from '@common/keychain'
import { ProviderSchema } from '@common/schemas'
import {
  createProvider,
  deleteProvider,
  getProvider,
  listProviders,
  resetProviderHealth,
  updateProvider,
} from '../database/store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'

export const providerRoutes: Record<string, ManagementHandler> = {
  '/api/provider/list': handleListProviders,
  '/api/provider/get': handleGetProvider,
  '/api/provider/create': handleCreateProvider,
  '/api/provider/update': handleUpdateProvider,
  '/api/provider/delete': handleDeleteProvider,
  '/api/provider/reset-health': handleResetProviderHealth,
}

function handleListProviders(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, listProviders())
}

const GetProviderSchema = z.object({ id: z.string() })
function handleGetProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id } = GetProviderSchema.parse(body)
  const provider = getProvider(id)
  if (!provider) {
    sendError(res, 'NOT_FOUND', 'Provider 不存在', 404)
    return
  }
  sendSuccess(res, provider)
}

const CreateProviderSchema = ProviderSchema.pick({
  name: true,
  timeoutMilliseconds: true,
  enabled: true,
}).extend({ apiKey: z.string().min(1) }).partial({ timeoutMilliseconds: true, enabled: true })

async function handleCreateProvider(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  const input = CreateProviderSchema.parse(body)
  const apiKeyReference = generateKeyReference()
  const secretStore = getSecretStore()
  await secretStore.set(apiKeyReference, input.apiKey)
  try {
    const provider = createProvider({
      name: input.name,
      apiKeyReference,
      timeoutMilliseconds: input.timeoutMilliseconds ?? 30000,
      enabled: input.enabled ?? true,
    })
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
}).partial().required({ id: true }).extend({ apiKey: z.string().min(1).optional() })

async function handleUpdateProvider(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  const { id, apiKey, ...updates } = UpdateProviderSchema.parse(body)
  const current = getProvider(id)
  if (!current) {
    sendError(res, 'NOT_FOUND', 'Provider 不存在', 404)
    return
  }
  if (apiKey) await getSecretStore().set(current.apiKeyReference, apiKey)
  sendSuccess(res, updateProvider(id, updates))
}

const DeleteProviderSchema = z.object({ id: z.string() })
async function handleDeleteProvider(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  const { id } = DeleteProviderSchema.parse(body)
  const provider = getProvider(id)
  deleteProvider(id)
  if (provider) await getSecretStore().delete(provider.apiKeyReference)
  sendSuccess(res, { id })
}

const ResetHealthSchema = z.object({ providerId: z.string() })
function handleResetProviderHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): void {
  const { providerId } = ResetHealthSchema.parse(body)
  resetProviderHealth(providerId)
  sendSuccess(res, { providerId })
}
