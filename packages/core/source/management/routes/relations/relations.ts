import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ProtocolConverterSchema, ProviderEndpointSchema, ProviderModelEndpointSchema, ProviderSettingSchema, withoutDefaults } from '@common/schemas'
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
} from '@server/database/provider-store'
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
} from '@server/database/model-store'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'

const IdSchema = z.object({ id: z.string().min(1) })
const ProviderIdSchema = z.object({ providerId: z.string().startsWith('prov_') })
const SettingIdSchema = ProviderSettingSchema.pick({ providerId: true, key: true })
const ProviderModelIdSchema = z.object({ providerModelId: z.string().min(1) })
const ProviderModelEndpointIdSchema = z.object({ providerModelEndpointId: z.string().min(1) })

function list<T>(schema: z.ZodType<T>, query: (input: T) => Promise<unknown>): ManagementHandler {
  return async (_req, res, body) => sendSuccess(res, await query(schema.parse(body)))
}

function get<T>(schema: z.ZodType<T>, query: (input: T) => Promise<unknown>, label: string): ManagementHandler {
  return async (_req, res, body) => {
    const result = await query(schema.parse(body))
    if (result === undefined) return sendError(res, 'NOT_FOUND', `${label} not found`, 404, { resource: label })
    sendSuccess(res, result)
  }
}

function mutate<T>(schema: z.ZodType<T>, action: (input: T) => Promise<unknown>): ManagementHandler {
  return async (_req: IncomingMessage, res: ServerResponse, body: unknown) => sendSuccess(res, await action(schema.parse(body)))
}

/**
 * 六张补丁 schema：更新接口「只改提到的字段」这一语义就靠它们。
 *
 * 三张源 schema 都先过了 `withoutDefaults` —— 这三个实体里 `enabled` 都带 `.default()`，
 * 而 zod v4 的 `.partial()` 会在字段缺省时**照旧套上默认值**。没过这一道，`PUT` 一个只有
 * `clientProtocol` 的补丁就会把 `enabled` 一起写成 `false`：`ProtocolConverterSchema`
 * 的默认值是 `false`（只有它，见契约里的注释），落到库里就是「建了一条转换器但它没生效」。
 * 详见 `withoutDefaults` 的注释。
 */
const ProviderEndpointPatchSchema = withoutDefaults(ProviderEndpointSchema)
const ProviderModelEndpointPatchSchema = withoutDefaults(ProviderModelEndpointSchema)
const ProtocolConverterPatchSchema = withoutDefaults(ProtocolConverterSchema)

const CreateEndpointSchema = ProviderEndpointPatchSchema.pick({ providerId: true, protocol: true, url: true, enabled: true }).partial({ enabled: true })
const UpdateEndpointSchema = ProviderEndpointPatchSchema.pick({ id: true, protocol: true, url: true, enabled: true }).partial().required({ id: true })
const CreateModelEndpointSchema = ProviderModelEndpointPatchSchema.pick({ providerModelId: true, providerEndpointId: true, url: true, enabled: true }).partial({ url: true, enabled: true })
const UpdateModelEndpointSchema = ProviderModelEndpointPatchSchema.pick({ id: true, providerEndpointId: true, url: true, enabled: true }).partial().required({ id: true })
const CreateConverterSchema = ProtocolConverterPatchSchema.pick({ providerModelEndpointId: true, clientProtocol: true, enabled: true }).partial({ enabled: true })
const UpdateConverterSchema = ProtocolConverterPatchSchema.pick({ id: true, clientProtocol: true, enabled: true }).partial().required({ id: true })

export const relationRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/relation/provider-setting/list', list(ProviderIdSchema, input => listProviderSettings(input.providerId)))
  .post('/api/relation/provider-setting/get', get(SettingIdSchema, input => getProviderSetting(input.providerId, input.key), 'Provider setting'))
  .post('/api/relation/provider-setting/upsert', mutate(ProviderSettingSchema.omit({ updatedTime: true }), upsertProviderSetting))
  .post('/api/relation/provider-setting/delete', mutate(SettingIdSchema, async input => { await deleteProviderSetting(input.providerId, input.key); return input }))
  .post('/api/relation/provider-endpoint/list', list(ProviderIdSchema, input => listProviderEndpoints(input.providerId)))
  .post('/api/relation/provider-endpoint/get', get(IdSchema, input => getProviderEndpoint(input.id), 'Provider endpoint'))
  .post('/api/relation/provider-endpoint/create', mutate(CreateEndpointSchema, createProviderEndpoint))
  .post('/api/relation/provider-endpoint/update', mutate(UpdateEndpointSchema, ({ id, ...updates }) => updateProviderEndpoint(id, updates)))
  .post('/api/relation/provider-endpoint/delete', mutate(IdSchema, async input => { await deleteProviderEndpoint(input.id); return input }))
  .post('/api/relation/provider-model-endpoint/list', list(ProviderModelIdSchema, input => listProviderModelEndpoints(input.providerModelId)))
  .post('/api/relation/provider-model-endpoint/get', get(IdSchema, input => getProviderModelEndpoint(input.id), 'Provider model endpoint'))
  .post('/api/relation/provider-model-endpoint/create', mutate(CreateModelEndpointSchema, createProviderModelEndpoint))
  .post('/api/relation/provider-model-endpoint/update', mutate(UpdateModelEndpointSchema, ({ id, ...updates }) => updateProviderModelEndpoint(id, updates)))
  .post('/api/relation/provider-model-endpoint/delete', mutate(IdSchema, async input => { await deleteProviderModelEndpoint(input.id); return input }))
  .post('/api/relation/protocol-converter/list', list(ProviderModelEndpointIdSchema, input => listProtocolConverters(input.providerModelEndpointId)))
  .post('/api/relation/protocol-converter/get', get(IdSchema, input => getProtocolConverter(input.id), 'Protocol converter'))
  .post('/api/relation/protocol-converter/create', mutate(CreateConverterSchema, createProtocolConverter))
  .post('/api/relation/protocol-converter/update', mutate(UpdateConverterSchema, ({ id, ...updates }) => updateProtocolConverter(id, updates)))
  .post('/api/relation/protocol-converter/delete', mutate(IdSchema, async input => { await deleteProtocolConverter(input.id); return input }))
