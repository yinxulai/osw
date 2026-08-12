import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { LogicalModelSchema } from '@common/schemas'
import {
  createLogicalModel,
  deleteLogicalModel,
  getLogicalModel,
  listLogicalModels,
  updateLogicalModel,
} from '../database/store'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'

export const modelRoutes: Record<string, ManagementHandler> = {
  '/api/logical-model/list': handleListLogicalModels,
  '/api/logical-model/get': handleGetLogicalModel,
  '/api/logical-model/create': handleCreateLogicalModel,
  '/api/logical-model/update': handleUpdateLogicalModel,
  '/api/logical-model/delete': handleDeleteLogicalModel,
}

function handleListLogicalModels(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, listLogicalModels())
}

const GetLogicalModelSchema = z.object({ id: z.string() })
function handleGetLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id } = GetLogicalModelSchema.parse(body)
  const model = getLogicalModel(id)
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

function handleCreateLogicalModel(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): void {
  const input = CreateLogicalModelSchema.parse(body)
  sendSuccess(res, createLogicalModel({
    name: input.name,
    description: input.description ?? '',
    enabled: input.enabled ?? true,
  }))
}

const UpdateLogicalModelSchema = LogicalModelSchema.partial().required({ id: true })
function handleUpdateLogicalModel(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): void {
  const { id, ...updates } = UpdateLogicalModelSchema.parse(body)
  sendSuccess(res, updateLogicalModel(id, updates))
}

const DeleteLogicalModelSchema = z.object({ id: z.string() })
function handleDeleteLogicalModel(
  _req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
): void {
  const { id } = DeleteLogicalModelSchema.parse(body)
  deleteLogicalModel(id)
  sendSuccess(res, { id })
}
