import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ProtocolSchema } from '@common/schemas'
import {
  getProviderModel,
  listProviderModels,
  listSchedulingPolicies,
  createUpstreamModel,
  updateUpstreamModel,
  upsertSchedulingPolicy,
  deleteSchedulingPolicy,
  deleteUpstreamModel,
} from '../database/store'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'

export const providerModelRoutes: Record<string, ManagementHandler> = {
  '/api/provider-model/list': handleListProviderModels,
  '/api/provider-model/get': handleGetProviderModel,
  '/api/provider-model/create': handleCreateProviderModel,
  '/api/provider-model/update': handleUpdateProviderModel,
  '/api/provider-model/delete': handleDeleteProviderModel,
  '/api/scheduling-policy/list': handleListSchedulingPolicies,
  '/api/scheduling-policy/update': handleUpdateSchedulingPolicy,
  '/api/scheduling-policy/delete': handleDeleteSchedulingPolicy,
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

const CreateProviderModelSchema = z.object({
  providerId: z.string().min(1),
  modelName: z.string().min(1),
  logicalModelId: z.string().min(1).default('auto'),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  endpoints: z.array(z.object({
    protocol: ProtocolSchema,
    upstreamUrl: z.string().default(''),
    customAuthHeader: z.string().nullable().default(null),
    protocolConversionEnabled: z.boolean().default(false),
  })).default([]),
})
async function handleCreateProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateProviderModelSchema.parse(body)
  const model = await createUpstreamModel(input)
  await upsertSchedulingPolicy({ logicalModelId: input.logicalModelId, providerModelId: model.id, priority: input.priority })
  sendSuccess(res, await getProviderModel(model.id) ?? model)
}

const UpdateProviderModelSchema = z.object({
  id: z.string().min(1),
  logicalModelId: z.string().min(1).optional(),
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
  })
  if (input.logicalModelId && input.priority !== undefined) {
    await upsertSchedulingPolicy({ logicalModelId: input.logicalModelId, providerModelId: input.id, priority: input.priority })
  }
  const view = await getProviderModel(updated.id)
  sendSuccess(res, view ?? updated)
}

async function handleDeleteProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetProviderModelSchema.parse(body)
  await deleteUpstreamModel(id)
  sendSuccess(res, { id })
}

const SchedulingPolicyListSchema = z.object({ logicalModelId: z.string().min(1).optional() }).default({})
async function handleListSchedulingPolicies(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = SchedulingPolicyListSchema.parse(body)
  sendSuccess(res, await listSchedulingPolicies(input.logicalModelId))
}

const SchedulingPolicyUpdateSchema = z.object({
  logicalModelId: z.string().min(1),
  providerModelId: z.string().min(1),
  strategy: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  weight: z.number().int().nonnegative().optional(),
  enabled: z.boolean().optional(),
  failoverEnabled: z.boolean().optional(),
})
async function handleUpdateSchedulingPolicy(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = SchedulingPolicyUpdateSchema.parse(body)
  sendSuccess(res, await upsertSchedulingPolicy(input))
}

const SchedulingPolicyDeleteSchema = z.object({ logicalModelId: z.string().min(1), providerModelId: z.string().min(1) })
async function handleDeleteSchedulingPolicy(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = SchedulingPolicyDeleteSchema.parse(body)
  await deleteSchedulingPolicy(input.logicalModelId, input.providerModelId)
  sendSuccess(res, { logicalModelId: input.logicalModelId, providerModelId: input.providerModelId })
}
