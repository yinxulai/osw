import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ProtocolConverterSchema, ProviderEndpointSchema, ProviderModelEndpointSchema, ProviderSettingSchema } from '@common/schemas'
import {
  createProviderEndpoint,
  deleteProviderEndpoint,
  deleteProviderSetting,
  getProviderEndpoint,
  getProviderSetting,
  listProviderEndpoints,
  listProviderSettings,
  updateProviderEndpoint,
  upsertProviderSetting,
} from '../database/provider-store'
import {
  createProtocolConverter,
  createProviderModelEndpoint,
  deleteProtocolConverter,
  deleteProviderModelEndpoint,
  getProtocolConverter,
  getProviderModelEndpoint,
  listProtocolConverters,
  listProviderModelEndpoints,
  updateProtocolConverter,
  updateProviderModelEndpoint,
} from '../database/model-store'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'

const IdSchema = z.object({ id: z.string().min(1) })
const ProviderIdSchema = z.object({ providerId: z.string().startsWith('prov_') })
const SettingIdSchema = ProviderSettingSchema.pick({ providerId: true, key: true })
const ProviderModelIdSchema = z.object({ providerModelId: z.string().min(1) })
const ProviderModelEndpointIdSchema = z.object({ providerModelEndpointId: z.string().min(1) })

function list<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, query: (input: T) => Promise<unknown>): ManagementHandler {
  return async (_req, res, body) => sendSuccess(res, await query(schema.parse(body)))
}

function get<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, query: (input: T) => Promise<unknown>, label: string): ManagementHandler {
  return async (_req, res, body) => {
    const result = await query(schema.parse(body))
    if (result === undefined) return sendError(res, 'NOT_FOUND', `${label} 不存在`, 404)
    sendSuccess(res, result)
  }
}

function mutate<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, action: (input: T) => Promise<unknown>): ManagementHandler {
  return async (_req: IncomingMessage, res: ServerResponse, body: unknown) => sendSuccess(res, await action(schema.parse(body)))
}

const CreateEndpointSchema = ProviderEndpointSchema.pick({ providerId: true, protocol: true, url: true, enabled: true }).partial({ enabled: true })
const UpdateEndpointSchema = ProviderEndpointSchema.pick({ id: true, protocol: true, url: true, enabled: true }).partial().required({ id: true })
const CreateModelEndpointSchema = ProviderModelEndpointSchema.pick({ providerModelId: true, providerEndpointId: true, url: true, enabled: true }).partial({ url: true, enabled: true })
const UpdateModelEndpointSchema = ProviderModelEndpointSchema.pick({ id: true, providerEndpointId: true, url: true, enabled: true }).partial().required({ id: true })
const CreateConverterSchema = ProtocolConverterSchema.pick({ providerModelEndpointId: true, clientProtocol: true, enabled: true }).partial({ enabled: true })
const UpdateConverterSchema = ProtocolConverterSchema.pick({ id: true, clientProtocol: true, enabled: true }).partial().required({ id: true })

export const relationRoutes: Record<string, ManagementHandler> = {
  '/api/relation/provider-setting/list': list(ProviderIdSchema, input => listProviderSettings(input.providerId)),
  '/api/relation/provider-setting/get': get(SettingIdSchema, input => getProviderSetting(input.providerId, input.key), 'Provider setting'),
  '/api/relation/provider-setting/upsert': mutate(ProviderSettingSchema.omit({ updatedTime: true }), upsertProviderSetting),
  '/api/relation/provider-setting/delete': mutate(SettingIdSchema, async input => { await deleteProviderSetting(input.providerId, input.key); return input }),
  '/api/relation/provider-endpoint/list': list(ProviderIdSchema, input => listProviderEndpoints(input.providerId)),
  '/api/relation/provider-endpoint/get': get(IdSchema, input => getProviderEndpoint(input.id), 'Provider endpoint'),
  '/api/relation/provider-endpoint/create': mutate(CreateEndpointSchema, createProviderEndpoint),
  '/api/relation/provider-endpoint/update': mutate(UpdateEndpointSchema, ({ id, ...updates }) => updateProviderEndpoint(id, updates)),
  '/api/relation/provider-endpoint/delete': mutate(IdSchema, async input => { await deleteProviderEndpoint(input.id); return input }),
  '/api/relation/provider-model-endpoint/list': list(ProviderModelIdSchema, input => listProviderModelEndpoints(input.providerModelId)),
  '/api/relation/provider-model-endpoint/get': get(IdSchema, input => getProviderModelEndpoint(input.id), 'Provider model endpoint'),
  '/api/relation/provider-model-endpoint/create': mutate(CreateModelEndpointSchema, createProviderModelEndpoint),
  '/api/relation/provider-model-endpoint/update': mutate(UpdateModelEndpointSchema, ({ id, ...updates }) => updateProviderModelEndpoint(id, updates)),
  '/api/relation/provider-model-endpoint/delete': mutate(IdSchema, async input => { await deleteProviderModelEndpoint(input.id); return input }),
  '/api/relation/protocol-converter/list': list(ProviderModelEndpointIdSchema, input => listProtocolConverters(input.providerModelEndpointId)),
  '/api/relation/protocol-converter/get': get(IdSchema, input => getProtocolConverter(input.id), 'Protocol converter'),
  '/api/relation/protocol-converter/create': mutate(CreateConverterSchema, createProtocolConverter),
  '/api/relation/protocol-converter/update': mutate(UpdateConverterSchema, ({ id, ...updates }) => updateProtocolConverter(id, updates)),
  '/api/relation/protocol-converter/delete': mutate(IdSchema, async input => { await deleteProtocolConverter(input.id); return input }),
}
