import { getSettings } from '@server/database/settings-store'

/**
 * 会话级缓存亲和（见 `apps/docs/specs/proxy-engine.md` §缓存亲和）。
 *
 * 大上下文请求的成本由 provider 侧 prompt cache 的命中决定，而命中取决于
 * 「同一会话的请求是否连续落在同一家供应商上」。故障转移天然打破这一点，
 * 冷却到期后的切回还会再打破一次。这里存的是第三块事实：
 * **哪个会话最近一次在哪家供应商模型上成功过**——规划器用它把会话粘在热缓存的
 * 候选上，成功收尾用它把绑定刷新到新的供应商模型。
 *
 * 绑定是**进程内**状态：代理重启后绑定消失，最多让每个活跃会话多付一次
 * prefill，不值得为此引入一张数据库表。数量有上限，回收是惰性的——
 * 会话数天然有界（活跃客户端数），上限只是防御性天花板。
 */

interface AffinityEntry {
  readonly providerModelId: string
  readonly expiresAt: number
}

/** 防御性上限：按「活跃会话数」的量级估算，超出的最早条目最先回收。 */
const MAX_ENTRIES = 1000

const bindings = new Map<string, AffinityEntry>()

function affinityKey(logicalModelId: string, sessionKey: string): string {
  // 会话键是客户端自己起的，全局不保证唯一；绑定的语义只在「同一个逻辑模型」内成立。
  return `${logicalModelId}\n${sessionKey}`
}

/**
 * 读取会话当前绑定的供应商模型。功能关闭、没有会话键、绑定不存在或已过期时返回 `null`，
 * 调度退化为纯优先级排序。**过期在读取时判定**，不做后台清扫：绑定只在规划时被问起。
 */
export async function resolveAffinityProviderModelId(logicalModelId: string, sessionKey: string | null | undefined): Promise<string | null> {
  if (!sessionKey) return null
  const settings = await getSettings()
  return readAffinityBinding(logicalModelId, sessionKey, settings.cacheAffinityEnabled)
}

/** `resolveAffinityProviderModelId` 的同步核心；批量规划读一次设置后逐落点调用它。TTL 只在写入时生效，读取时只看开关。 */
export function readAffinityBinding(logicalModelId: string, sessionKey: string | null | undefined, enabled: boolean): string | null {
  if (!enabled || !sessionKey) return null
  const entry = bindings.get(affinityKey(logicalModelId, sessionKey))
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    bindings.delete(affinityKey(logicalModelId, sessionKey))
    return null
  }
  return entry.providerModelId
}

/**
 * 把会话绑定到这次成功的供应商模型上，并在绑定已存在时改绑（failover 之后的那次成功）。
 *
 * 功能关闭或没有会话键时什么都不做——调用方（成功收尾）不需要为此分支。
 */
export async function recordAffinityProviderModelId(logicalModelId: string, sessionKey: string | null | undefined, providerModelId: string): Promise<void> {
  if (!sessionKey) return
  const settings = await getSettings()
  writeAffinityBinding(logicalModelId, sessionKey, providerModelId, settings.cacheAffinityEnabled, settings.cacheAffinityTtlSeconds)
}

/** `recordAffinityProviderModelId` 的同步核心，与 {@link readAffinityBinding} 共用同一份 TTL 语义。 */
export function writeAffinityBinding(logicalModelId: string, sessionKey: string | null | undefined, providerModelId: string, enabled: boolean, ttlSeconds: number): void {
  if (!enabled || !sessionKey) return
  const key = affinityKey(logicalModelId, sessionKey)
  // 先删再插：Map 的插入序就是 FIFO 回收序，改绑要记的是「这次」的时间，不是最早那次。
  bindings.delete(key)
  bindings.set(key, { providerModelId, expiresAt: Date.now() + ttlSeconds * 1000 })
  if (bindings.size > MAX_ENTRIES) pruneBindings()
}

function pruneBindings(): void {
  const now = Date.now()
  for (const [key, entry] of bindings) {
    if (now >= entry.expiresAt) bindings.delete(key)
  }
  // 过期清完还超额，就按插入序丢最旧的：绑定只是缓存语义的优化，丢掉的代价是
  // 那几个会话下一次请求多付一次 prefill，不是正确性问题。
  while (bindings.size > MAX_ENTRIES) {
    const oldest = bindings.keys().next().value
    if (oldest === undefined) break
    bindings.delete(oldest)
  }
}

/** 只给测试用：清空全部绑定，让用例之间互不携带状态。 */
export function clearAffinityStoreForTests(): void {
  bindings.clear()
}
