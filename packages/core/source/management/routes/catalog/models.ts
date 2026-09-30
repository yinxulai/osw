import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { LogicalModelIdSchema } from '@common/schemas'
import {
  createLogicalModel,
  deleteLogicalModel,
  getLogicalModel,
  listLogicalModels,
  reorderLogicalModels,
  updateLogicalModel,
} from '@server/database/logical-model-store'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { HttpRouter } from '@server/http-router'

/**
 * 逻辑模型的接口。
 *
 * 入参里的 `id` 一律是**数据记录 id**（`lm_*`，本机生成、永不变）：界面上拖动排序、
 * 打开弹窗、点删除拿到的都是它。只有 `modelId` 是用户看得见、改得动的那把钥匙。
 * 两者混用不会报错，只会悄悄作用于另一个模型 —— 所以这里每个 schema 都写清楚。
 */
export const modelRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/logical-model/list', handleListLogicalModels)
  .post('/api/logical-model/get', handleGetLogicalModel)
  .post('/api/logical-model/create', handleCreateLogicalModel)
  .post('/api/logical-model/update', handleUpdateLogicalModel)
  .post('/api/logical-model/reorder', handleReorderLogicalModels)
  .post('/api/logical-model/delete', handleDeleteLogicalModel)

async function handleListLogicalModels(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await listLogicalModels())
}

const GetLogicalModelSchema = z.object({ id: z.string() })
async function handleGetLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetLogicalModelSchema.parse(body)
  const model = await getLogicalModel(id)
  if (!model) {
    sendError(res, 'NOT_FOUND', 'Logical model not found', 404)
    return
  }
  sendSuccess(res, model)
}

/** 创建只收 `modelId`：数据记录 id 由服务端生成，调用方给不了也不应该给。 */
const CreateLogicalModelSchema = z.object({
  modelId: LogicalModelIdSchema,
  description: z.string().optional(),
  enabled: z.boolean().optional(),
})

async function handleCreateLogicalModel(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateLogicalModelSchema.parse(body)
  sendSuccess(res, await createLogicalModel({
    modelId: input.modelId,
    description: input.description ?? '',
    enabled: input.enabled ?? true,
  }))
}

/**
 * 改说明、开关与模型 id。
 *
 * 改 `modelId` 其实是**改名**（要连路由定义里的引用一起搬），但它与「改说明」在界面上是
 * 同一个弹窗、同一次提交，所以不单开一条路由：拆成两条只会多出一个「改了一半」的中间态，
 * 而改名一旦要在两个请求里各做一半，失败重试就得由界面自己拼回去。
 */
const UpdateLogicalModelSchema = z.object({
  id: z.string(),
  modelId: LogicalModelIdSchema.optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
})

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

const ReorderLogicalModelsSchema = z.object({ ids: z.array(z.string().min(1)).min(1) })
async function handleReorderLogicalModels(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { ids } = ReorderLogicalModelsSchema.parse(body)
  sendSuccess(res, await reorderLogicalModels(ids))
}
