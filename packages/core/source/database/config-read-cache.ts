/**
 * 配置读缓存：让**逻辑模型 / 供应商 / 供应商模型**这些「用户配完之后长期不变」的配置
 * 常驻内存，读的时候不再每次都回库。
 *
 * 为什么值得做：代理每处理一个请求都要把「请求里的模型名」翻成落点、把落点翻成候选、
 * 再给每个候选补上供应商信息。这些读在实现上是 `逻辑模型全表 → 每个候选一次 getProvider`
 * 的 N+1，而它们读的东西**只有用户动配置时才会变**。把它们留在内存里，一次请求的配置读写
 * 就从「十几次」降到「零次」，供应商信息、模型名这些还会被日志与实时台账反复取用。
 *
 * 缓存只有一条正确性来源：**代（generation）**。每次配置被写，代加一；读缓存命中时比对代，
 * 不等就丢弃重读。这样失效是「一次性全体作废」而不是逐键维护——配置写是低频的（用户在界面上
 * 点出来的），逐键精细失效带来的复杂度与漏失效的风险都不划算。
 *
 * **它不是事实源。** 事实永远在 `config-v1.db`；这里只是它的一个只读投影，且只在两次配置写
 * 之间有效。任何写路径只要经过 `database/index.ts` 的配置库句柄，都会自动把代加一
 * （见那里的 `wrapConfigHandleWithInvalidation`），不需要每个 store 自己记得调失效——
 * 「记得调」正是会漏的那一类约定。
 *
 * 缓存值是**按引用**存下来的（`LogicalModel[]`、`Provider[]` 等）。调用方一律当成只读：
 * 这里不做深拷贝，拷贝反而会让「常驻内存省下来的时间」又交回去。
 */
interface CacheEntry {
  /** 写进缓存时配置库的代；与当前代不等即为失效。 */
  generation: number
  value: unknown
}

const entries = new Map<string, CacheEntry>()
let generation = 0

/** 当前配置库的代。仅用于测试与诊断，业务代码不需要直接读它。 */
export function configReadCacheGeneration(): number {
  return generation
}

/**
 * 作废整份配置读缓存。
 *
 * 由配置库句柄在**任何一次写**（`insert` / `update` / `delete` / `transaction`）之前自动调用，
 * 也由连接层在开库、关库时调用——关库后模块级缓存必须清空，否则下一次开库（同一进程里测试
 * 会这么做）会拿着上一个库的值继续命中。
 */
export function invalidateConfigReadCache(): void {
  generation += 1
}

/**
 * 读一个配置值，能命中就命中。
 *
 * `key` 必须**唯一标识这次读取**（函数名 + 影响结果的入参），否则两次不同的查询会互相顶掉。
 * 读本身是同步的（`node:sqlite` 的 `.all()` / `.get()`），`await` 只是为了让调用方的
 * `async` 签名保持不变；真出现「读的过程中配置被写」，那也只是这一格缓存写在了新代上，
 * 下一次写会把它一起作废。
 *
 * **读失败不入缓存**：异常在 `await` 处抛出，`entries.set` 根本不会执行。把一次瞬时故障
 * 缓存成常驻值，会让它一直重放到下一次配置写为止。
 */
export async function cachedConfigRead<T>(key: string, read: () => T | Promise<T>): Promise<T> {
  const cached = entries.get(key)
  if (cached !== undefined && cached.generation === generation) return cached.value as T
  const value = await read()
  entries.set(key, { generation, value })
  return value
}
