import { describe, expect, it } from 'vitest'
import type { UsageTrendPoint } from '@common/schemas'
import { disjointTrendPoint } from './trend-bars'

function point(overrides: Partial<UsageTrendPoint> = {}): UsageTrendPoint {
  return {
    label: '2026-01-08 10:30',
    inputTokens: 20,
    outputTokens: 4,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningTokens: 0,
    ...overrides,
  }
}

/** 五段相加，应与卡片上的「输入 + 输出」相等。 */
function stackedTotal(row: ReturnType<typeof disjointTrendPoint>): number {
  return row.uncachedInputTokens + row.cachedInputTokens + row.cacheCreationInputTokens + row.plainOutputTokens + row.reasoningTokens
}

describe('disjointTrendPoint', () => {
  // 观测层样本：Anthropic `input_tokens: 8` 加上 cache read 7、cache write 5，
  // 落库为 `inputTokens: 20`、`outputTokens: 4`。卡片总量是 24，叠起来是 36（issue #84）。
  it('缓存与思考从父级里减掉，五段之和等于输入加输出', () => {
    const row = disjointTrendPoint(point({ cachedInputTokens: 7, cacheCreationInputTokens: 5 }))

    expect(row.uncachedInputTokens).toBe(8)
    expect(row.plainOutputTokens).toBe(4)
    expect(stackedTotal(row)).toBe(24)
  })

  it('推理 Token 单独成段，输出只剩非思考部分', () => {
    const row = disjointTrendPoint(point({ inputTokens: 10, outputTokens: 9, reasoningTokens: 6 }))

    expect(row.plainOutputTokens).toBe(3)
    expect(row.reasoningTokens).toBe(6)
    expect(stackedTotal(row)).toBe(19)
  })

  // 子集比父级还大时（历史数据、混合网关的半截报文）不能画出负数段。
  it('子集超过父级时截到 0，柱高仍以父级为上限', () => {
    const row = disjointTrendPoint(point({ inputTokens: 2, outputTokens: 1, cachedInputTokens: 5, reasoningTokens: 3 }))

    expect(row.uncachedInputTokens).toBe(0)
    expect(row.plainOutputTokens).toBe(0)
    // 缓存读取 5 + 思考 3：两个子集各自成段，父级里减掉的部分不产生段。
    expect(stackedTotal(row)).toBe(8)
  })

  // Tooltip 的「输入」是缓存命中率的分母，必须是落库总量。
  it('不改写 inputTokens / outputTokens 这两个总量', () => {
    const row = disjointTrendPoint(point({ cachedInputTokens: 7, cacheCreationInputTokens: 5 }))

    expect(row.inputTokens).toBe(20)
    expect(row.outputTokens).toBe(4)
    expect(row.label).toBe('2026-01-08 10:30')
  })
})
