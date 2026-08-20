import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { UpstreamModelSchema } from '@common/schemas'
import {
  createUpstreamModel,
  deleteUpstreamModel,
  listLogicalModels,
  listUpstreamModelsByLogicalModel,
  updateUpstreamModel,
} from '../database/store'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'

export const upstreamModelRoutes: Record<string, ManagementHandler> = {
  '/api/upstream-model/list': handleListUpstreamModels,
  '/api/upstream-model/create': handleCreateUpstreamModel,
  '/api/upstream-model/update': handleUpdateUpstreamModel,
  '/api/upstream-model/delete': handleDeleteUpstreamModel,
}

const ListUpstreamModelsSchema = z.object({ logicalModelId: z.string() })
async function handleListUpstreamModels(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { logicalModelId } = ListUpstreamModelsSchema.parse(body)
  sendSuccess(res, await listUpstreamModelsByLogicalModel(logicalModelId))
}

const CreateUpstreamModelSchema = UpstreamModelSchema.pick({
  logicalModelId: true,
  providerId: true,
  upstreamModelId: true,
  endpoints: true,
  priority: true,
  enabled: true,
}).partial({ logicalModelId: true, endpoints: true, enabled: true })

/** 当前激活的逻辑模型：enabled 优先，否则第一个；MVP 阶段前端可不传 logicalModelId */
async function resolveActiveLogicalModelId(): Promise<string> {
  const models = await listLogicalModels()
  const active = models.find(model => model.enabled) ?? models[0]
  if (!active) throw new Error('没有可用的逻辑模型')
  return active.id
}

async function handleCreateUpstreamModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateUpstreamModelSchema.parse(body)
  sendSuccess(res, await createUpstreamModel({
    logicalModelId: input.logicalModelId ?? (await resolveActiveLogicalModelId()),
    providerId: input.providerId,
    upstreamModelId: input.upstreamModelId,
    endpoints: input.endpoints ?? [],
    priority: input.priority,
    enabled: input.enabled ?? true,
  }))
}

const UpdateUpstreamModelSchema = UpstreamModelSchema.partial().required({ id: true })
async function handleUpdateUpstreamModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id, ...updates } = UpdateUpstreamModelSchema.parse(body)
  sendSuccess(res, await updateUpstreamModel(id, updates))
}

const DeleteUpstreamModelSchema = z.object({ id: z.string() })
async function handleDeleteUpstreamModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = DeleteUpstreamModelSchema.parse(body)
  await deleteUpstreamModel(id)
  sendSuccess(res, { id })
}
