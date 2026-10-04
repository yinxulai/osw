import type { IncomingHttpHeaders } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { listApiKeys } from '@server/database/api-key-store'
import { configReadCacheGeneration } from '@server/database/config-read-cache'

/**
 * 客户端 API Key 的入口校验。
 *
 * ## 为什么要「反查」
 *
 * 库里每一行只存 `keyReference`（见 `api-key-store.ts`），明文在宿主的密钥存储里。
 * 于是校验的方向不是「拿 id 取密钥来比对」，而是「拿客户端递来的明文，问它属于哪把 Key」——
 * 一个反查。做法是把当前所有**可用** Key 的明文读出来，常数时间逐条比对。
 *
 * 这份明文清单按配置库的**代**缓存：Key 的新增、改名、启停、删除都会写配置库、
 * 让代自增，于是缓存自动作废（与 `config-read-cache.ts` 同一套失效机制，不另立一套）。
 * 缓存的是「这次校验要用的名单」，不是事实源——事实源永远是库 + 密钥存储。
 *
 * ## 什么时候才做这件事
 *
 * 只有设置 `apiKeyAuthEnabled` 打开时才校验（未打开时全部请求都算匿名）。
 * 这是**运行期设置**而不是编译期特性开关：默认保持零配置可用（新用户不必先建 Key），
 * 但一旦打开，没带 Key / 带错 Key 的请求立刻被 401 挡住（issue #27 的威胁模型）。
 */

/** 客户端可能用来递 Key 的头，与转发侧脱敏用的 `CLIENT_AUTH_HEADERS` 保持一致。 */
const CLIENT_AUTH_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key'] as const

/** `authorization: Bearer <token>` 的壳；`x-api-key` 这类头直接就是裸 token。 */
const BEARER_PREFIX = /^bearer\s+/i

/**
 * 从请求头里取出客户端递来的明文 Key。
 *
 * 多个头同时出现时按上面的顺序取第一个非空的：这几个头是等价的载体，
 * 客户端通常只用一个；同时用多个（且不一致）没有明确语义，取第一个即可，不报错。
 */
export function extractPresentedApiKey(headers: IncomingHttpHeaders): string | null {
  for (const name of CLIENT_AUTH_HEADERS) {
    const raw = headers[name]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (!value) continue
    const token = value.trim().replace(BEARER_PREFIX, '').trim()
    if (token) return token
  }
  return null
}

/** 常数时间比较两段明文：避免用「第几个字符开始不一样」泄漏关于密钥的信息。 */
function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

interface CachedIdentity {
  generation: number
  /** 明文 → 记录 id。只收「启用中且未过期」的 Key。 */
  bySecret: Map<string, string>
}

let cachedIdentity: CachedIdentity | null = null

/**
 * 载入「明文 → 记录 id」的反查表，按配置库代缓存。
 *
 * 过期判断在这里做一次：过期的 Key 不进表，于是它自然校验不过——
 * 不需要在每次校验时再判断一遍时间，也避免「名单里有它、校验时说它过期」的两处口径。
 */
async function loadIdentityMap(): Promise<Map<string, string>> {
  const generation = configReadCacheGeneration()
  if (cachedIdentity && cachedIdentity.generation === generation) return cachedIdentity.bySecret
  const time = Date.now()
  const secretStore = getSecretStore()
  const bySecret = new Map<string, string>()
  for (const key of await listApiKeys()) {
    if (!key.enabled) continue
    if (key.expiresTime !== null && key.expiresTime <= time) continue
    const secret = await secretStore.get(key.keyReference)
    if (secret) bySecret.set(secret, key.id)
  }
  cachedIdentity = { generation, bySecret }
  return bySecret
}

/** 拿明文去反查表里找一把可用的 Key；找不到返回 `null`。 */
async function matchApiKey(presented: string): Promise<string | null> {
  const bySecret = await loadIdentityMap()
  for (const [secret, id] of bySecret) {
    if (secretsEqual(secret, presented)) return id
  }
  return null
}

export interface ApiKeyIdentity {
  /** 通过校验后绑定的记录 id；未开启校验或匿名时为 `null`。 */
  apiKeyId: string | null
  /** 这次请求是否被允许继续。仅在校验开启且未通过时为 `false`。 */
  authorized: boolean
}

/**
 * 解析这次请求的 API Key 身份。
 *
 * - 校验关闭：一律放行，身份为 `null`（所有请求都算匿名）。
 * - 校验开启且带了有效 Key：放行，身份为该 Key 的记录 id。
 * - 校验开启但没带 / 带了不匹配、已停用、已过期的 Key：不放行。
 */
export async function resolveApiKeyIdentity(headers: IncomingHttpHeaders, enforced: boolean): Promise<ApiKeyIdentity> {
  if (!enforced) return { apiKeyId: null, authorized: true }
  const presented = extractPresentedApiKey(headers)
  if (!presented) return { apiKeyId: null, authorized: false }
  const apiKeyId = await matchApiKey(presented)
  return { apiKeyId, authorized: apiKeyId !== null }
}

/** 仅供测试：清空反查表缓存。 */
export function resetApiKeyIdentityCache(): void {
  cachedIdentity = null
}
