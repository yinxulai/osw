import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { LogicalModelSchema } from '@common/schemas'
import {
  createLogicalModel,
  deleteLogicalModel,
  getLogicalModel,
  listLogicalModels,
  updateLogicalModel,
} from '../database/logical-model-store'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'
import { HttpRouter } from '../http-router'

export const modelRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/logical-model/list', handleListLogicalModels)
  .post('/api/logical-model/get', handleGetLogicalModel)
  .post('/api/logical-model/create', handleCreateLogicalModel)
  .post('/api/logical-model/update', handleUpdateLogicalModel)
  .post('/api/logical-model/delete', handleDeleteLogicalModel)

async function handleListLogicalModels(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await listLogicalModels())
}

const GetLogicalModelSchema = z.object({ id: z.string() })
async function handleGetLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetLogicalModelSchema.parse(body)
  const model = await getLogicalModel(id)
  if (!model) {
    sendError(res, 'NOT_FOUND', '逻辑模型不存在', 404)
    return
  }
  sendSuccess(res, model)
}

const CreateLogicalModelSchema = LogicalModelSchema.pick({
  name: true,
  description: true,
  enabled: true,
}).partial({ description: true, enabled: true })

async function handleCreateLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateLogicalModelSchema.parse(body)
  sendSuccess(res, await createLogicalModel({
    name: input.name,
    description: input.description ?? '',
    enabled: input.enabled ?? true,
  }))
}

const UpdateLogicalModelSchema = LogicalModelSchema.partial().required({ id: true })
async function handleUpdateLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id, ...updates } = UpdateLogicalModelSchema.parse(body)
  sendSuccess(res, await updateLogicalModel(id, updates))
}

const DeleteLogicalModelSchema = z.object({ id: z.string() })
async function handleDeleteLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = DeleteLogicalModelSchema.parse(body)
  await deleteLogicalModel(id)
  sendSuccess(res, { id })
}
