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
 * 两个开关分开看（见 `ApiKeyIdentityPolicy`）：
 *
 * - **认身份**：模块开着（`apiKeyFeatureEnabled`）就做——请求带的 Key 对上了就记下它属于哪一把。
 *   「按 Key 统计用量」「最近使用时间」全靠这一步，所以它**不能**只在拦截打开时才跑。
 * - **拦请求**：还要 `apiKeyAuthEnabled` 也打开。没带 / 带错的请求立刻 401（issue #27 的威胁模型）。
 *
 * 这是**运行期设置**而不是编译期特性开关：默认保持零配置可用（新用户不必先建 Key），
 * 但一旦打开拦截，没带 Key / 带错 Key 的请求立刻被挡住。
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

/** 拿明文去反查表里找一把可用的 Key；找不到返回 `null`。 */
async function matchApiKey(presented: string): Promise<string | null> {
  const bySecret = await loadIdentityMap()
  for (const [secret, id] of bySecret) {
    if (secretsEqual(secret, presented)) return id
  }
  return null
}

export interface ApiKeyIdentity {
  /** 认出来的那把 Key 的记录 id；没带、对不上、或模块关着时为 `null`。 */
  apiKeyId: string | null
  /** 这次请求是否被允许继续。仅在「拦截」打开且没认出来时为 `false`。 */
  authorized: boolean
}

/**
 * 这次请求按哪套规则处理身份。
 *
 * 「认身份」与「拦请求」是**两件不同的事**，这里把它们分开，因为默认配置下两者恰好相反：
 * 默认「认身份但不拦」（零配置可用，同时按 Key 的用量有数据可看）。
 */
export interface ApiKeyIdentityPolicy {
  /** Key 模块是否存在。关掉时整条按 Key 的路径不存在，一律匿名、且不读密钥存储。 */
  tracked: boolean
  /** 是否拒绝没带 / 带错 Key 的请求。 */
  enforced: boolean
}

/**
 * 解析这次请求的 API Key 身份。
 *
 * - 模块关着：一律放行且不带身份（等价于这个功能从没实现过，也免得白读一遍密钥存储）。
 * - 模块开着：带了能对上号的 Key 就**记下身份**——不论要不要拦。这是「按 Key 统计用量」
 *   与「最近使用时间」的数据来源；只认不拦不会让任何请求被多拒一次。
 * - 拦截也开着：没带 / 对不上（含已停用、已过期）一律不放行。
 */
export async function resolveApiKeyIdentity(headers: IncomingHttpHeaders, policy: ApiKeyIdentityPolicy): Promise<ApiKeyIdentity> {
  if (!policy.tracked) return { apiKeyId: null, authorized: true }
  const presented = extractPresentedApiKey(headers)
  if (!presented) return { apiKeyId: null, authorized: !policy.enforced }
  const apiKeyId = await matchApiKey(presented)
  return { apiKeyId, authorized: !policy.enforced || apiKeyId !== null }
}

/** 仅供测试：清空反查表缓存。 */
export function resetApiKeyIdentityCache(): void {
  cachedIdentity = null
}
