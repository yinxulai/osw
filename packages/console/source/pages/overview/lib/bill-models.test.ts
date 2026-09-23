import { describe, expect, it } from 'vitest'
import type { ModelStat } from '@common/schemas'
import { buildBillRows } from './bill-models'

function modelStat(overrides: Partial<ModelStat> & Pick<ModelStat, 'providerModelName'>): ModelStat {
  return {
    providerModelId: `pm_${overrides.providerModelName}`,
    providerId: 'p1',
    providerName: 'Provider One',
    attempts: 1,
    success: 1,
    successRate: 1,
    avgTtftMs: null,
    avgTps: null,
    avgOutputTokens: null,
    cacheHitRate: null,
    ...overrides,
    outputTokens: overrides.outputTokens ?? 0,
    inputTokens: overrides.inputTokens ?? 0,
    cachedInputTokens: overrides.cachedInputTokens ?? 0,
  }
}

describe('buildBillRows', () => {
  // 用户会有好几家供应商提供同一个模型名；账单没有「供应商」这一列，
  // 同名拆成两行会被读成两笔不同的消费。
  it('把不同供应商的同名模型合并成一行，并累加用量与输入', () => {
    const rows = buildBillRows([
      modelStat({ providerModelName: 'gpt-5', providerId: 'a', providerName: 'A', success: 2, outputTokens: 600, inputTokens: 1000, cachedInputTokens: 100 }),
      modelStat({ providerModelName: 'gpt-5', providerId: 'b', providerName: 'B', success: 1, outputTokens: 400, inputTokens: 3000, cachedInputTokens: 900 }),
    ], 12)

    expect(rows).toEqual([
      { id: 'gpt-5', name: 'gpt-5', usageTokens: 1000, cacheHitRate: 0.25 },
    ])
  })

  // 命中率必须由合并后的合计相除得出；各供应商命中率的算术平均会得到 0.55，
  // 与账单顶部那一行「缓存输入 ÷ 输入」的口径不同源。
  it('合并后的命中率用合计相除，而不是各项命中率的平均', () => {
    const rows = buildBillRows([
      modelStat({ providerModelName: 'gpt-5', providerId: 'a', success: 1, inputTokens: 100, cachedInputTokens: 100 }),
      modelStat({ providerModelName: 'gpt-5', providerId: 'b', success: 1, inputTokens: 100, cachedInputTokens: 10 }),
    ], 12)

    expect(rows[0].cacheHitRate).toBeCloseTo(110 / 200)
  })

  // 同名模型合并后占一个名额，而不是各自占一个名额把别的模型挤出去。
  it('先合并再截断，同一个模型只占一个名额', () => {
    const rows = buildBillRows([
      modelStat({ providerModelName: 'gpt-5', providerId: 'a', success: 1, outputTokens: 10 }),
      modelStat({ providerModelName: 'gpt-5', providerId: 'b', success: 1, outputTokens: 10 }),
      modelStat({ providerModelName: 'sonnet', success: 1, outputTokens: 15 }),
      modelStat({ providerModelName: 'haiku', success: 1, outputTokens: 5 }),
    ], 2)

    expect(rows.map(row => row.name)).toEqual(['gpt-5', 'sonnet'])
  })

  it('同名的不同大小写算两个模型，不猜测它们是不是一个', () => {
    const rows = buildBillRows([
      modelStat({ providerModelName: 'gpt-5', success: 1, outputTokens: 10 }),
      modelStat({ providerModelName: 'GPT-5', success: 1, outputTokens: 20 }),
    ], 12)

    expect(rows.map(row => row.name)).toEqual(['GPT-5', 'gpt-5'])
  })

  // 「没有成功调用」与「成功调用产出 0 个 Token」是两件事，前者写 `—`、后者写 0。
  it('没有成功调用时用量写 null，成功但零输出写 0', () => {
    const rows = buildBillRows([
      modelStat({ providerModelName: 'dead', success: 0, attempts: 3, outputTokens: 0 }),
      modelStat({ providerModelName: 'empty', success: 2, outputTokens: 0 }),
    ], 12)

    const dead = rows.find(row => row.name === 'dead')
    const empty = rows.find(row => row.name === 'empty')
    expect(dead?.usageTokens).toBeNull()
    expect(empty?.usageTokens).toBe(0)
  })

  // 没有输入 Token 就是没测到，不是命中率为零。
  it('合并后没有输入 Token 时命中率写 null', () => {
    const rows = buildBillRows([
      modelStat({ providerModelName: 'gpt-5', success: 1, outputTokens: 10, inputTokens: 0, cachedInputTokens: 0 }),
    ], 12)

    expect(rows[0].cacheHitRate).toBeNull()
  })

  it('用量相同时按名字排序，两次调用的顺序一致', () => {
    const rows = buildBillRows([
      modelStat({ providerModelName: 'zeta', success: 1, outputTokens: 10 }),
      modelStat({ providerModelName: 'alpha', success: 1, outputTokens: 10 }),
    ], 12)

    expect(rows.map(row => row.name)).toEqual(['alpha', 'zeta'])
  })
})
