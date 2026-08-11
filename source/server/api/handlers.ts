import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  listLogicalModels,
  getLogicalModel,
  createLogicalModel,
  updateLogicalModel,
  deleteLogicalModel,
  listBindingsByModel,
  createBinding,
  updateBinding,
  deleteBinding,
  getSettings,
  updateSettings,
  listProviderHealth,
  resetProviderHealth,
} from '../db/store'
import { ProviderSchema, LogicalModelSchema, ModelBindingSchema, SettingsSchema } from '@common/schemas'
import { setManualBinding, getManualBinding } from '../proxy/handler'

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void

const routes: Record<string, Handler> = {
  // Provider
  '/api/provider/list': handleListProviders,
  '/api/provider/get': handleGetProvider,
  '/api/provider/create': handleCreateProvider,
  '/api/provider/update': handleUpdateProvider,
  '/api/provider/delete': handleDeleteProvider,
  '/api/provider/reset-health': handleResetProviderHealth,

  // Logical Model
  '/api/logical-model/list': handleListLogicalModels,
  '/api/logical-model/get': handleGetLogicalModel,
  '/api/logical-model/create': handleCreateLogicalModel,
  '/api/logical-model/update': handleUpdateLogicalModel,
  '/api/logical-model/delete': handleDeleteLogicalModel,

  // Model Binding
  '/api/binding/list': handleListBindings,
  '/api/binding/create': handleCreateBinding,
  '/api/binding/update': handleUpdateBinding,
  '/api/binding/delete': handleDeleteBinding,

  // Settings
  '/api/settings/get': handleGetSettings,
  '/api/settings/update': handleUpdateSettings,

  // Queue / Switching
  '/api/queue/status': handleQueueStatus,
  '/api/queue/switch': handleQueueSwitch,

  // Health
  '/api/health/list': handleListHealth,
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, 'http://localhost')
  const handler = routes[url.pathname]

  if (!handler) {
    sendError(res, 'NOT_FOUND', `API 路径不存在: ${url.pathname}`, 404)
    return
  }

  try {
    const body = await parseJsonBody(req)
    await handler(req, res, body)
  } catch (err) {
    if (err instanceof z.ZodError) {
      sendError(res, 'VALIDATION_ERROR', err.errors.map(e => e.message).join('; '), 400)
    } else {
      sendError(res, 'INTERNAL_ERROR', (err as Error).message, 500)
    }
  }
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function sendSuccess(res: ServerResponse, data: unknown): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: true, data }))
}

function sendError(res: ServerResponse, errorCode: string, errorMessage: string, statusCode = 400): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage }))
}

// ========== Provider Handlers ==========

function handleListProviders(_req: IncomingMessage, res: ServerResponse): void {
  const providers = listProviders()
  sendSuccess(res, providers)
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
  apiKeyReference: true,
  timeoutMilliseconds: true,
  enabled: true,
}).partial({ timeoutMilliseconds: true, enabled: true })
function handleCreateProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const input = CreateProviderSchema.parse(body)
  const provider = createProvider({
    name: input.name,
    apiKeyReference: input.apiKeyReference,
    timeoutMilliseconds: input.timeoutMilliseconds ?? 30000,
    enabled: input.enabled ?? true,
  })
  sendSuccess(res, provider)
}

const UpdateProviderSchema = ProviderSchema.partial().required({ id: true })
function handleUpdateProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id, ...updates } = UpdateProviderSchema.parse(body)
  const provider = updateProvider(id, updates)
  sendSuccess(res, provider)
}

const DeleteProviderSchema = z.object({ id: z.string() })
function handleDeleteProvider(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id } = DeleteProviderSchema.parse(body)
  deleteProvider(id)
  sendSuccess(res, { id })
}

const ResetHealthSchema = z.object({ providerId: z.string() })
function handleResetProviderHealth(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { providerId } = ResetHealthSchema.parse(body)
  resetProviderHealth(providerId)
  sendSuccess(res, { providerId })
}

// ========== Logical Model Handlers ==========

function handleListLogicalModels(_req: IncomingMessage, res: ServerResponse): void {
  const models = listLogicalModels()
  sendSuccess(res, models)
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
function handleCreateLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const input = CreateLogicalModelSchema.parse(body)
  const model = createLogicalModel({
    name: input.name,
    description: input.description ?? '',
    enabled: input.enabled ?? true,
  })
  sendSuccess(res, model)
}

const UpdateLogicalModelSchema = LogicalModelSchema.partial().required({ id: true })
function handleUpdateLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id, ...updates } = UpdateLogicalModelSchema.parse(body)
  const model = updateLogicalModel(id, updates)
  sendSuccess(res, model)
}

const DeleteLogicalModelSchema = z.object({ id: z.string() })
function handleDeleteLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id } = DeleteLogicalModelSchema.parse(body)
  deleteLogicalModel(id)
  sendSuccess(res, { id })
}

// ========== Binding Handlers ==========

const ListBindingsSchema = z.object({ logicalModelId: z.string() })
function handleListBindings(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { logicalModelId } = ListBindingsSchema.parse(body)
  const bindings = listBindingsByModel(logicalModelId)
  sendSuccess(res, bindings)
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
  const binding = createBinding({
    logicalModelId: input.logicalModelId,
    providerId: input.providerId,
    protocol: input.protocol,
    upstreamUrl: input.upstreamUrl,
    upstreamModelId: input.upstreamModelId,
    priority: input.priority,
    enabled: input.enabled ?? true,
    customAuthHeader: input.customAuthHeader ?? null,
  })
  sendSuccess(res, binding)
}

const UpdateBindingSchema = ModelBindingSchema.partial().required({ id: true })
function handleUpdateBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id, ...updates } = UpdateBindingSchema.parse(body)
  const binding = updateBinding(id, updates)
  sendSuccess(res, binding)
}

const DeleteBindingSchema = z.object({ id: z.string() })
function handleDeleteBinding(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { id } = DeleteBindingSchema.parse(body)
  deleteBinding(id)
  sendSuccess(res, { id })
}

// ========== Settings Handlers ==========

function handleGetSettings(_req: IncomingMessage, res: ServerResponse): void {
  const settings = getSettings()
  sendSuccess(res, settings)
}

const UpdateSettingsSchema = SettingsSchema.partial().omit({ id: true })
function handleUpdateSettings(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const updates = UpdateSettingsSchema.parse(body)
  const settings = updateSettings(updates)
  sendSuccess(res, settings)
}

// ========== Queue Handlers ==========

function handleQueueStatus(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, {
    manualBindingId: getManualBinding(),
  })
}

const SwitchQueueSchema = z.object({ bindingId: z.string().nullable() })
function handleQueueSwitch(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { bindingId } = SwitchQueueSchema.parse(body)
  setManualBinding(bindingId)
  sendSuccess(res, { bindingId })
}

// ========== Health Handlers ==========

function handleListHealth(_req: IncomingMessage, res: ServerResponse): void {
  const healthList = listProviderHealth()
  sendSuccess(res, healthList)
}
