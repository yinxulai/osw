/**
 * 目录存储的最低要求：只声明我们真正用到的那几个 D1 动作。
 *
 * **刻意不依赖 `@cloudflare/workers-types`**：那样一个类型包会把整个运行时类型体系拉进来，
 * 而我们只用到「prepare → bind → first/all/run」这一条极窄的路。声明成结构化接口有两个好处：
 *
 * 1. 测试里可以塞一个内存实现，不必起一个 D1；
 * 2. 「目录用到哪些 SQL 能力」这件事在签名上一眼可见——想用 `batch()` 或事务，先得改这里。
 *
 * 形状与 Cloudflare 的 D1 一致（`D1Database` / `D1PreparedStatement` 的子集），所以真实的
 * `env.SHARED_RULES_DB` 可以直接传进来，不需要适配层。
 */

/** `all()` 的返回：结果行加一个成功标记。 */
export interface D1Result<T> {
  results: T[]
  success: boolean
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<unknown>
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatement
}
