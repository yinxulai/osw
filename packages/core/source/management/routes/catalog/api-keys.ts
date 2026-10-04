import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { generateKeyReference } from '@common/secret-store'
import { ApiKeySchema, CreatedApiKeySchema, type CreatedApiKey } from '@common/schemas'
import {
  createApiKey,
  deleteApiKey as deleteApiKeyRecord,
  getApiKey,
  listApiKeys,
  updateApiKey,
} from '@server/database/api-key-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'

/**
 * 客户端 API Key 的管理面。
 *
 * 与供应商配置一样，**明文与元数据分开走**：元数据（名字、开关、过期时间）落配置库，
 * 明文落宿主的密钥存储（`secretStore`），库里只留 `keyReference`。明文只在创建与轮换的
 * 响应里出现一次——服务端之后不再持有可回显的那一份（`get` 取出来的永远是元数据）。
 *
 * 之所以不像供应商那样「一次会话内可回显」：客户端 Key 是发给别人用的凭据，
 * 「事后还能在界面上看见」本身就是一个泄漏面，所以设计成写一次、抄走、之后只看元数据。
 */
export const apiKeyRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/api-key/list', handleList)
  .post('/api/api-key/get', handleGet)
  .post('/api/api-key/create', handleCreate)
  .post('/api/api-key/update', handleUpdate)
  .post('/api/api-key/delete', handleDelete)
  .post('/api/api-key/rotate', handleRotate)

/** 客户端凭据的明文外形：`osw-` + 32 字节随机数的 hex。 */
function generateApiKeySecret(): string {
  return `osw-${randomBytes(32).toString('hex')}`
}

async function handleList(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await listApiKeys())
}

const GetApiKeySchema = z.object({ id: z.string().min(1) })
async function handleGet(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetApiKeySchema.parse(body)
  const key = await getApiKey(id)
  if (!key) {
    sendError(res, 'NOT_FOUND', `API key not found: ${id}`, 404, { apiKeyId: id })
    return
  }
  sendSuccess(res, key)
}

const CreateApiKeySchema = ApiKeySchema.pick({ name: true, enabled: true, expiresTime: true })
  .partial({ enabled: true, expiresTime: true })

async function handleCreate(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = CreateApiKeySchema.parse(body)
  const keyReference = generateKeyReference()
  const secret = generateApiKeySecret()
  const secretStore = getSecretStore()
  await secretStore.set(keyReference, secret)
  try {
    const key = await createApiKey({
      name: input.name,
      keyReference,
      enabled: input.enabled ?? true,
      expiresTime: input.expiresTime ?? null,
    })
    // 明文只在这里出现一次；`CreatedApiKeySchema` 就是这条契约的类型化表达。
    sendSuccess(res, CreatedApiKeySchema.parse({ ...key, secret }) satisfies CreatedApiKey)
  } catch (error) {
    // 元数据没落库，明文就不该留在密钥存储里——否则它会变成一把「库里查不到、但谁也不知道」的孤儿密钥。
    await secretStore.delete(keyReference)
    throw error
  }
}

const UpdateApiKeySchema = ApiKeySchema.pick({ id: true, name: true, enabled: true, expiresTime: true })
  .partial()
  .required({ id: true })

async function handleUpdate(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id, ...updates } = UpdateApiKeySchema.parse(body)
  sendSuccess(res, await updateApiKey(id, updates))
}

const DeleteApiKeySchema = z.object({ id: z.string().min(1) })
async function handleDelete(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = DeleteApiKeySchema.parse(body)
  await deleteApiKeyAndSecret(id)
  sendSuccess(res, { id })
}

/**
 * 删除一把 Key：先软删元数据（保住历史请求日志对它的引用），再删密钥存储里的明文。
 *
 * 顺序不能反：先删明文会让「删到一半失败」留下一条指向不存在明文的活跃 Key，
 * 校验时它永远匹配不上、但又占着名字，用户看不出哪里坏了。
 */
export async function deleteApiKeyAndSecret(id: string): Promise<void> {
  const key = await getApiKey(id)
  await deleteApiKeyRecord(id)
  if (key) await getSecretStore().delete(key.keyReference)
}

/**
 * 轮换明文：同一把 Key 的元数据（id、名字、开关、过期）不动，只换掉密钥本身。
 *
 * 用于「怀疑泄露了、但不想让引用这把 Key 的客户端改 id」的场景——旧明文立即失效
 * （密钥存储里被覆盖），新明文在响应里回一次。
 */
async function handleRotate(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = GetApiKeySchema.parse(body)
  const current = await getApiKey(id)
  if (!current) {
    sendError(res, 'NOT_FOUND', `API key not found: ${id}`, 404, { apiKeyId: id })
    return
  }
  const secret = generateApiKeySecret()
  // 覆盖同一 `keyReference`：旧明文因此被顶掉，不需要额外再删一次。
  await getSecretStore().set(current.keyReference, secret)
  sendSuccess(res, CreatedApiKeySchema.parse({ ...current, secret }) satisfies CreatedApiKey)
}
