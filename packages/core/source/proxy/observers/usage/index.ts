/**
 * 用量读取的对外入口。
 *
 * 这个文件只做导出，不含逻辑：调用方（`attempt-observer`、`live-request-observer`、
 * `probe-response`）继续 `from './usage'` / `from '@server/proxy/observers/usage'`，
 * 导入路径与导出名都不变。
 *
 * 内部分工：
 * - `adapters/*` —— 每家上游承认哪些字段、按什么优先级（唯一的字段清单所在地）；
 * - `registry.ts` —— 适配器顺序、聚合别名、以及混合网关的显式输入语义规则；
 * - `tracker.ts` —— 逐事件累积与 SSE 切帧；
 * - `stream-signals.ts` —— 「有没有真实输出」与输出 Token 估算。
 */
export { emptyUsage } from './types'
export type { ExtractedUsage, UsageTracker } from './types'
export { extractTokenUsage } from './registry'
export { createUsageTracker } from './tracker'
export { hasOutput } from './stream-signals'
