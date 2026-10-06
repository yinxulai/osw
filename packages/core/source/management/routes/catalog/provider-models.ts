import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { ProtocolSchema } from '@common/schemas'
import {
  createProviderModelRoute,
  deleteProviderModelRoute,
  getProviderModel,
  listProviderModels,
  listProviderModelsForLogicalModel,
  updateProviderModelRoute,
} from '@server/database/model-store'
import {
  deleteSchedulingPolicy,
  getDefaultLogicalModelRecordId,
  getLogicalModelRecordIdOrThrow,
  listSchedulingPolicies,
  upsertSchedulingPolicy,
} from '@server/database/logical-model-store'
import { HttpRouter } from '@server/http-router'
import { resourceNotFoundError } from '@server/errors'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

export const providerModelRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/provider-model/list', handleListProviderModels)
  .post('/api/provider-model/list-by-logical-model', handleListProviderModelsByLogicalModel)
  .post('/api/provider-model/get', handleGetProviderModel)
  .post('/api/provider-model/create', handleCreateProviderModel)
  .post('/api/provider-model/update', handleUpdateProviderModel)
  .post('/api/provider-model/delete', handleDeleteProviderModel)
  .post('/api/scheduling-policy/list', handleListSchedulingPolicies)
  .post('/api/scheduling-policy/update', handleUpdateSchedulingPolicy)
  .post('/api/scheduling-policy/delete', handleDeleteSchedulingPolicy)

/**
 * 调度绑定接口里的 `logicalModelId` 一律是**数据记录 id**（`lm_*`），不是模型名：
 * `scheduling_policies` 外键指着的那把钥匙才是这里的口径。路由里的模型名属于请求时的事，
 * 由 `getAvailableModels` 内部翻译，不经过管理接口。
 */

const ListProviderModelsSchema = z.object({ includeDeleted: z.boolean().optional() }).default({})
async function handleListProviderModels(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = ListProviderModelsSchema.parse(body)
  sendSuccess(res, await listProviderModels(input.includeDeleted ?? false))
}

async function handleListProviderModelsByLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = z.object({ logicalModelId: z.string().min(1), includeDeleted: z.boolean().optional() }).parse(body)
  sendSuccess(res, await listProviderModelsForLogicalModel(input.logicalModelId, input.includeDeleted ?? false, true))
}

/**
 * 把接口传上来的落点翻成**确实存在的数据记录 id**。
 *
 * 没指名落点时，新绑定挂在**内建默认逻辑模型**上：它的数据记录 id 是本机生成的，
 * 界面拿不到、也不该关心，所以由服务端自己去找。
 *
 * 指名了落点就先确认它存在。这一步不只为了回一个好听的 404：绑定的外键指着记录 id，
 * 拿一个不存在的记录 id（典型是把**模型名** `'default'` 当成记录 id 传上来）去写，
 * SQLite 会抛一句对用户毫无意义的 `FOREIGN KEY constraint failed`；而且一旦写入分两步
 * （先建模型、再建绑定），第一步已经提交了，第二步才失败就是一个**孤儿模型**。
 * 提前在这里停下，两个问题一起消失。
 */
async function resolveSchedulingTarget(logicalModelId: string | undefined): Promise<string> {
  if (logicalModelId === undefined) return getDefaultLogicalModelRecordId()
  return getLogicalModelRecordIdOrThrow(logicalModelId)
}

const GetProviderModelSchema = z.object({ id: z.string().min(1) })
async function handleGetProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetProviderModelSchema.parse(body)
  const model = await getProviderModel(id)
  // 读一个不存在的模型是 404，不是 500：它是「你要的东西不在了」（可能刚在另一个页签删掉），
  // 界面按 `errors.RESOURCE_NOT_FOUND` 说清楚，比一句「内部错误」有用得多。
  if (!model) throw resourceNotFoundError('provider model', id)
  sendSuccess(res, model)
}

const CreateProviderModelSchema = z.object({
  providerId: z.string().min(1),
  modelName: z.string().min(1),
  logicalModelId: z.string().min(1).optional(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  endpoints: z.array(z.object({
    protocol: ProtocolSchema,
    endpointUrl: z.string().default(''),
    customAuthHeader: z.string().nullable().default(null),
    protocolConversionEnabled: z.boolean().default(false),
  })).default([]),
})
async function handleCreateProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateProviderModelSchema.parse(body)
  // **先定落点再建模型**：落点不存在（模型名当记录 id、或那个逻辑模型已被删）时一个字节都不落库。
  // 反过来（先建模型、再写绑定）一旦绑定失败，模型已经提交，就成了「接口报错了、模型却已存在」的孤儿。
  const logicalModelRecordId = await resolveSchedulingTarget(input.logicalModelId)
  const model = await createProviderModelRoute({
    providerId: input.providerId,
    modelName: input.modelName,
    endpoints: input.endpoints,
    priority: input.priority,
    enabled: input.enabled,
  })
  // 新模型的第一条绑定跟着模型本体走：模型建出来就是停用的，绑定不能默认打开
  // （`upsertSchedulingPolicy` 会拒绝为停用模型打开绑定）。
  await upsertSchedulingPolicy({ logicalModelId: logicalModelRecordId, providerModelId: model.id, priority: input.priority, enabled: model.enabled })
  // 一个模型可以同时绑多个协议的端点，每个端点都是一次「这项协议能力被接进来」：
  // 逐个发，不发「第一个」——挑一个发等于把「这个模型支持哪几种协议」答成残缺的。
  // （一个协议在模型上只会有一条绑定，是存储层按供应商端点唯一的约束保证的，见 `model-store.ts`。）
  for (const endpoint of input.endpoints) {
    reportTelemetryEvent({ name: 'model_created', protocol: endpoint.protocol })
  }
  sendSuccess(res, await getProviderModel(model.id) ?? model)
}

const UpdateProviderModelSchema = z.object({
  id: z.string().min(1),
  logicalModelId: z.string().min(1).optional(),
  modelName: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  endpoints: z.array(z.object({
    protocol: ProtocolSchema,
    endpointUrl: z.string().default(''),
    customAuthHeader: z.string().nullable().default(null),
    protocolConversionEnabled: z.boolean().default(false),
  })).optional(),
  priority: z.number().int().optional(),
})
async function handleUpdateProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = UpdateProviderModelSchema.parse(body)
  const updated = await updateProviderModelRoute(input.id, {
    ...(input.modelName !== undefined ? { modelName: input.modelName } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.endpoints !== undefined ? { endpoints: input.endpoints } : {}),
  })
  if (input.logicalModelId && input.priority !== undefined) {
    await upsertSchedulingPolicy({ logicalModelId: await getLogicalModelRecordIdOrThrow(input.logicalModelId), providerModelId: input.id, priority: input.priority })
  }
  const view = await getProviderModel(updated.id)
  sendSuccess(res, view ?? updated)
}

async function handleDeleteProviderModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetProviderModelSchema.parse(body)
  await deleteProviderModelRoute(id)
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
  weight: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
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
