import type { UsageTrendPoint } from '@common/schemas'

export interface TrendBarPoint extends UsageTrendPoint {
  /** 未缓存输入。总输入减去缓存读取与缓存写入，不小于 0。 */
  uncachedInputTokens: number
  /** 不含思考的输出，不小于 0。 */
  plainOutputTokens: number
}

/**
 * 柱子要互不相交的五段；Tooltip 仍写落库的总量。
 *
 * `inputTokens` 已经是总输入：OpenAI 的 `prompt_tokens` 含缓存，只有缺少这份正数总输入时，
 * 观测层才按 Anthropic 语义把 cache read 与 cache write 加回去。`outputTokens` 含推理 Token。
 * 卡片上的 Token 总量只加输入与输出，所以缓存和思考不能再叠在父级上面。
 * 未缓存输入是 `input - cache read - cache write`，不含思考的输出是 `output - reasoning`，
 * 减出来的负数截到 0。
 *
 * Tooltip 不跟着改成这两截：同一页的缓存命中率是「缓存读取 ÷ 输入总量」，
 * 「输入」必须仍是那个分母。
 */
export function disjointTrendPoint(point: UsageTrendPoint): TrendBarPoint {
  const cacheRead = Math.max(0, point.cachedInputTokens)
  const cacheWrite = Math.max(0, point.cacheCreationInputTokens)
  const reasoning = Math.max(0, point.reasoningTokens)
  return {
    ...point,
    cachedInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
    reasoningTokens: reasoning,
    uncachedInputTokens: Math.max(0, point.inputTokens - cacheRead - cacheWrite),
    plainOutputTokens: Math.max(0, point.outputTokens - reasoning),
  }
}
