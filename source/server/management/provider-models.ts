import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ProtocolSchema } from '@common/schemas'
import {
  getProviderModel,
  listProviderModels,
  updateUpstreamModel,
} from '../database/store'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'

export const providerModelRoutes: Record<string, ManagementHandler> = {
  '/api/provider-model/list': handleListProviderModels,
  '/api/provider-model/get': handleGetProviderModel,
  '/api/provider-model/update': handleUpdateProviderModel,
}

const ListProviderModelsSchema = z.object({ includeDeleted: z.boolean().optional() }).default({})
async function handleListProviderModels(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = ListProviderModelsSchema.parse(body)
  sendSuccess(res, await listProviderModels(input.includeDeleted ?? false))
}

const GetProviderModelSchema = z.object({ id: z.string().min(1) })
async function handleGetProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetProviderModelSchema.parse(body)
  const model = await getProviderModel(id)
  if (!model) throw new Error(`provider model not found: ${id}`)
  sendSuccess(res, model)
}

const UpdateProviderModelSchema = z.object({
  id: z.string().min(1),
  modelName: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  endpoints: z.array(z.object({
    protocol: ProtocolSchema,
    upstreamUrl: z.string().default(''),
    customAuthHeader: z.string().nullable().default(null),
    protocolConversionEnabled: z.boolean().default(false),
  })).optional(),
  priority: z.number().int().optional(),
})
async function handleUpdateProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = UpdateProviderModelSchema.parse(body)
  const updated = await updateUpstreamModel(input.id, {
    ...(input.modelName !== undefined ? { upstreamModelId: input.modelName } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.endpoints !== undefined ? { endpoints: input.endpoints } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
  })
  const view = await getProviderModel(updated.id)
  sendSuccess(res, view ?? updated)
}
