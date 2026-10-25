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
 * 只有模块开着（`apiKeyFeatureEnabled`）才做。模块关着时读完像这个功能从未实现：一律匿名、
 * 不读密钥存储、不拒绝任何请求。
 *
 * 模块开着就意味着**必须携带 Key**，没有「只认不拦」那么一档：认出来就记下身份（按 Key 统计
 * 用量、最近使用时间靠它），没带 / 对不上就 401。这两件事本就是同一个开关的两半，拆开只会
 * 造出「界面上在管 Key、代理侧却不认 Key」的自相矛盾状态。
 *
 * 唯一的例外是**库里一把可用 Key 都没有**（全新安装、或用户把 Key 全删了）：此时无从携带，
 * 请求放行并记成匿名，否则装好的第一天永远跑不通。这个例外不需要额外开关，它是从「有没有 Key」
 * 直接推出来的——建好第一把就自动生效。
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
 *
 * 单把 Key 读不出明文时**跳过它而不是整车失败**：反查表是「所有 Key 一起服务所有请求」的
 * 公共资源，一次系统钥匙串抽风（锁定、被别的进程占住）不应该把整台代理变成 401。
 * 跳过意味着那把 Key 此刻验不过（它的客户端会收到 401），其余 Key 照常工作。
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
    let secret: string | null
    try {
      secret = await secretStore.get(key.keyReference)
    } catch (error) {
      // 不让进缓存的那个决定也跟着抛：这一轮先跳过，下一轮会重新试。
      console.warn(`[proxy] failed to read api key secret id=${key.id} reference=${key.keyReference}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (secret) bySecret.set(secret, key.id)
  }
  cachedIdentity = { generation, bySecret }
  return bySecret
}

export interface ApiKeyIdentity {
  /** 认出来的那把 Key 的记录 id；没带、对不上、或模块关着时为 `null`。 */
  apiKeyId: string | null
  /** 这次请求是否被允许继续。仅在模块开着、且认不出传来的 Key 时为 `false`。 */
  authorized: boolean
}

/**
 * 解析这次请求的 API Key 身份。
 *
 * - 模块关着：一律放行且不带身份（等价于这个功能从没实现过，也免得白读一遍密钥存储）。
 * - 模块开着：带了能对上号的 Key 就**记下身份**——这是「按 Key 统计用量」与「最近使用时间」
 *   的数据来源。没带、对不上（含已停用、已过期）一律不放行（issue #27 的威胁模型）。
 * - 库里的可用 Key 表为空：放行并记成匿名。此时「携带一把 Key」这个要求根本无法满足，
 *   继续拒绝只会让全新安装的第一条请求就撞上 401——建好第一把之后这个分支自然不再进。
 */
export async function resolveApiKeyIdentity(headers: IncomingHttpHeaders, enabled: boolean): Promise<ApiKeyIdentity> {
  if (!enabled) return { apiKeyId: null, authorized: true }
  const bySecret = await loadIdentityMap()
  if (bySecret.size === 0) return { apiKeyId: null, authorized: true }
  const presented = extractPresentedApiKey(headers)
  if (!presented) return { apiKeyId: null, authorized: false }
  for (const [secret, id] of bySecret) {
    if (secretsEqual(secret, presented)) return { apiKeyId: id, authorized: true }
  }
  return { apiKeyId: null, authorized: false }
}

/** 仅供测试：清空反查表缓存。 */
export function resetApiKeyIdentityCache(): void {
  cachedIdentity = null
}
