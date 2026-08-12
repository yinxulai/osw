import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ModelBindingSchema } from '@common/schemas'
import {
  createBinding,
  deleteBinding,
  listBindingsByModel,
  updateBinding,
} from '../database/store'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'

export const bindingRoutes: Record<string, ManagementHandler> = {
  '/api/binding/list': handleListBindings,
  '/api/binding/create': handleCreateBinding,
  '/api/binding/update': handleUpdateBinding,
  '/api/binding/delete': handleDeleteBinding,
}

const ListBindingsSchema = z.object({ logicalModelId: z.string() })
function handleListBindings(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { logicalModelId } = ListBindingsSchema.parse(body)
  sendSuccess(res, listBindingsByModel(logicalModelId))
}

const CreateBindingSchema = ModelBindingSchema.pick({
  logicalModelId: true,
  providerId: true,
  protocol: true,
  upstreamUrl: true,
  upstreamModelId: true,
  priority: true,
  enabled: true,
  customAuthHeader: true,
}).partial({ enabled: true, customAuthHeader: true })

function handleCreateBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const input = CreateBindingSchema.parse(body)
  sendSuccess(res, createBinding({
    logicalModelId: input.logicalModelId,
    providerId: input.providerId,
    protocol: input.protocol,
    upstreamUrl: input.upstreamUrl,
    upstreamModelId: input.upstreamModelId,
    priority: input.priority,
    enabled: input.enabled ?? true,
    customAuthHeader: input.customAuthHeader ?? null,
  }))
}

const UpdateBindingSchema = ModelBindingSchema.partial().required({ id: true })
function handleUpdateBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id, ...updates } = UpdateBindingSchema.parse(body)
  sendSuccess(res, updateBinding(id, updates))
}

const DeleteBindingSchema = z.object({ id: z.string() })
function handleDeleteBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id } = DeleteBindingSchema.parse(body)
  deleteBinding(id)
  sendSuccess(res, { id })
}
