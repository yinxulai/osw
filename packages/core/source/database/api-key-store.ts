import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { ApiKeySchema } from '@common/schemas'
import type { ApiKey } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { duplicateApiKeyNameError, resourceNotFoundError } from '../errors'
import { cachedConfigRead } from './config-read-cache'
import { getConfigDb } from './index'
import { apiKeys } from './config-schema'

/**
 * 客户端 API Key 的读写。
 *
 * 这里只碰**元数据**（名字、开关、过期时间、密钥存储引用）。明文从不经过这个文件：
 * 写入由调用方先 `secretStore.set()` 换回一个 `keyReference` 再传进来，删除由调用方
 * 在标记删除后 `secretStore.delete()`。理由与供应商凭据一致（见 `provider-store.ts`）。
 *
 * 名字的唯一性是**应用层规则**，不是数据库唯一索引：与供应商 / 逻辑模型一样，
 * 「不许重名」的主语是**活着的那一行**。删掉一把 Key 再建同名的应该成功，
 * 写成 DB 约束就会逼删除路径改名腾位（见 `config-schema.ts` 头部的第 4 条不变量）。
 */

/** 列出所有活跃（未删除）的 Key。走常驻读缓存：界面、日志回填、分析页都会反复读它。 */
export async function listApiKeys(): Promise<ApiKey[]> {
  return cachedConfigRead('apiKeys', readApiKeys)
}

async function readApiKeys(): Promise<ApiKey[]> {
  return getConfigDb().select().from(apiKeys)
    .where(isNull(apiKeys.deletedTime))
    .orderBy(asc(apiKeys.createdTime))
    .all()
    .map(mapApiKey)
}

export async function getApiKey(id: string): Promise<ApiKey | undefined> {
  return cachedConfigRead(`apiKey:${id}`, () => readApiKey(id))
}

async function readApiKey(id: string): Promise<ApiKey | undefined> {
  const row = getConfigDb().select().from(apiKeys).where(eq(apiKeys.id, id)).get()
  return row ? mapApiKey(row) : undefined
}

/** 按密钥引用取 Key：代理侧拿到的是明文，需要反查它属于哪一把（见 `resolve-api-key.ts`）。 */
export async function getApiKeyByReference(keyReference: string): Promise<ApiKey | undefined> {
  return cachedConfigRead(`apiKeyByReference:${keyReference}`, async () => {
    const row = getConfigDb().select().from(apiKeys).where(eq(apiKeys.keyReference, keyReference)).get()
    return row ? mapApiKey(row) : undefined
  })
}

/**
 * 「活跃的 Key 里不许重名」。
 *
 * 与 `assertLogicalModelIdAvailable` 同一形状：命中就抛一个带具名错误码的 409，
 * 而不是让 SQLITE 抛一个用户读不懂的约束错误（这里没有 DB 约束可撞，更不能靠它兜底）。
 * 软删除的行不在管辖范围：它们已经把名字让出来了。
 */
function assertApiKeyNameAvailable(name: string, excludeId?: string): void {
  const rows = getConfigDb().select({ id: apiKeys.id }).from(apiKeys)
    .where(and(eq(apiKeys.name, name), isNull(apiKeys.deletedTime)))
    .all()
  if (rows.some(row => row.id !== excludeId)) throw duplicateApiKeyNameError(name)
}

export interface CreateApiKeyInput {
  name: string
  keyReference: string
  enabled?: boolean
  /** 过期时间（毫秒时间戳）。`undefined` / `null` 都表示永不过期。 */
  expiresTime?: number | null
}

export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKey> {
  assertApiKeyNameAvailable(input.name)
  const id = generateId('ak_')
  const time = now()
  const key = ApiKeySchema.parse({
    id,
    name: input.name,
    keyReference: input.keyReference,
    enabled: input.enabled ?? true,
    expiresTime: input.expiresTime ?? null,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  })
  getConfigDb().insert(apiKeys).values({ ...key, deletedTime: null }).run()
  return key
}

export type UpdateApiKeyInput = Partial<Pick<ApiKey, 'name' | 'enabled' | 'expiresTime'>>

export async function updateApiKey(id: string, updates: UpdateApiKeyInput): Promise<ApiKey> {
  const existing = await getApiKey(id)
  if (!existing || existing.deletedTime !== null) throw resourceNotFoundError('API key', id)
  if (updates.name !== undefined) assertApiKeyNameAvailable(updates.name, id)
  const next: ApiKey = { ...existing, ...updates, id, updatedTime: now() }
  getConfigDb().update(apiKeys)
    .set({ name: next.name, enabled: next.enabled, expiresTime: next.expiresTime, updatedTime: next.updatedTime })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.deletedTime)))
    .run()
  return next
}

/**
 * 软删除一把 Key。
 *
 * 只打标、不删行：请求日志的 `apiKeyId` 会留下历史引用，硬删会让「哪把 Key 用过多少」
 * 在统计里变成一堆查不到身份的空 id。真正的密钥（明文）由调用方在此之后从密钥存储删掉——
 * 那是它唯一该消失的地方，「哪把 Key 花过额度」这份历史不因此消失。
 */
export async function deleteApiKey(id: string): Promise<void> {
  const time = now()
  getConfigDb().update(apiKeys)
    .set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.deletedTime)))
    .run()
}

/** 供重命名时的冲突探测：除自己以外，活跃行里是否已经有这个名字。 */
export async function apiKeyNameInUse(name: string, excludeId?: string): Promise<boolean> {
  const rows = getConfigDb().select({ id: apiKeys.id }).from(apiKeys)
    .where(and(eq(apiKeys.name, name), isNull(apiKeys.deletedTime), excludeId ? ne(apiKeys.id, excludeId) : undefined))
    .all()
  return rows.length > 0
}

function mapApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return ApiKeySchema.parse({
    ...row,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    expiresTime: row.expiresTime === null ? null : Number(row.expiresTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  })
}
