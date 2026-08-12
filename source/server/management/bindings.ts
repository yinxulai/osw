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
async function handleListBindings(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { logicalModelId } = ListBindingsSchema.parse(body)
  sendSuccess(res, await listBindingsByModel(logicalModelId))
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

async function handleCreateBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateBindingSchema.parse(body)
  sendSuccess(res, await createBinding({
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
async function handleUpdateBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id, ...updates } = UpdateBindingSchema.parse(body)
  sendSuccess(res, await updateBinding(id, updates))
}

const DeleteBindingSchema = z.object({ id: z.string() })
async function handleDeleteBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = DeleteBindingSchema.parse(body)
  await deleteBinding(id)
  sendSuccess(res, { id })
}
