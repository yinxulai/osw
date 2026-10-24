import { describe, expect, it } from 'vitest'
import { calculateProviderModelMetrics, providerModelMetricKey } from './provider-model-metrics'
import type { AttemptStatus, RequestStatus } from './schemas'

/**
 * 「哪个模型快」这件事必须只有一个口径：控制台的模型详情与托盘摘要读的是同一张
 * `request_logs`，但各自拼出的字段形状不同，所以这里刻意只吃指标计算用得到的那几个字段
 * （`status` / `providerId` / `providerModelId` / `ttftMilliseconds` / `durationMilliseconds` /
 * `outputTokens`），让两边能共用同一次聚合。
 *
 * 三个容易搞错的地方在这里被钉住：
 * 1. 归属看的是**真正成功的那次尝试**，不是请求日志上记的模型；
 * 2. 同一个请求被重试到不只一个模型时，只算成功的那个，样本不重复计；
 * 3. 没有速度与速度为零是两件事——前者是 `null`。
 */
interface AttemptOverrides {
  providerId: string
  status: AttemptStatus
  ttftMilliseconds: number | null
  durationMilliseconds: number
}

function attemptOf(providerModelId: string, overrides: Partial<AttemptOverrides> = {}) {
  return {
    status: (overrides.status ?? 'success') as AttemptStatus,
    providerId: overrides.providerId ?? `prov_${providerModelId}`,
    providerModelId,
    ttftMilliseconds: overrides.ttftMilliseconds === undefined ? 100 : overrides.ttftMilliseconds,
    durationMilliseconds: overrides.durationMilliseconds ?? 1_000,
  }
}

interface LogOverrides { status: RequestStatus; outputTokens: number | null }

function logOf(id: string, attempts: readonly ReturnType<typeof attemptOf>[], overrides: Partial<LogOverrides> = {}) {
  return {
    id,
    status: (overrides.status ?? 'success') as RequestStatus,
    outputTokens: overrides.outputTokens === undefined ? 100 : overrides.outputTokens,
    attempts,
  }
}

describe('providerModelMetricKey', () => {
  it('用 NUL 拼接，避免两段里出现分隔符时撞键', () => {
    expect(providerModelMetricKey('prov_1', 'gpt-4o')).toBe('prov_1\0gpt-4o')
    // 常见分隔符（`:`、`/`、`-`）会在这两对上撞成同一个键，NUL 不会。
    expect(providerModelMetricKey('prov_1:gpt', '4o')).not.toBe(providerModelMetricKey('prov_1', 'gpt:4o'))
    expect(providerModelMetricKey('prov_1/gpt', '4o')).not.toBe(providerModelMetricKey('prov_1', 'gpt/4o'))
  })

  // 如实记录：NUL 只挡住了「手工挑出来的分隔符」这一种撞键。两段里**自身**带 NUL 时仍会撞
  // （`'a'+NUL+'b\0c'` 与 `'a\0b'+NUL+'c'` 是同一个字符串）。这里的 id 都来自本库主键，
  // 不可能含 NUL，所以不值得为它加转义——但这条边界得写下来，免得下次被当成「已彻底防撞」。
  it('两段自身带 NUL 时仍会撞键，这是已知边界', () => {
    expect(providerModelMetricKey('a', 'b\0c')).toBe(providerModelMetricKey('a\0b', 'c'))
  })

  it('同一个 provider 与模型永远得到同一个键', () => {
    expect(providerModelMetricKey('p', 'm')).toBe(providerModelMetricKey('p', 'm'))
    expect(providerModelMetricKey('p', 'm')).not.toBe(providerModelMetricKey('m', 'p'))
  })
})

describe('calculateProviderModelMetrics 的样本归属', () => {
  it('只统计成功的请求', () => {
    const metrics = calculateProviderModelMetrics([
      logOf('r1', [attemptOf('fast')]),
      logOf('r2', [attemptOf('fast')], { status: 'failed' }),
      logOf('r3', [attemptOf('fast')], { status: 'cancelled' }),
    ])

    expect(metrics[providerModelMetricKey('prov_fast', 'fast')]?.sampleCount).toBe(1)
  })

  // 失败请求里也可能有成功的尝试（后续尝试成功前半路失败），但请求整体不算成功样本。
  it('请求未成功时即使里面有一次成功尝试也不算样本', () => {
    const metrics = calculateProviderModelMetrics([logOf('r1', [attemptOf('fast', { status: 'failed' }), attemptOf('backup')], { status: 'failed' })])

    expect(metrics).toEqual({})
  })

  it('一次尝试都没有的请求不进统计', () => {
    expect(calculateProviderModelMetrics([logOf('r1', [])])).toEqual({})
  })

  // 重试链上先试 A、失败、再试 B 成功：这一条样本属于 B，A 不该因为「被试过」而拿到样本。
  it('归属真正成功的那次尝试，而不是被先试过的那个', () => {
    const metrics = calculateProviderModelMetrics([
      logOf('r1', [attemptOf('slow', { status: 'failed', ttftMilliseconds: 900 }), attemptOf('fast', { ttftMilliseconds: 50 })]),
    ])

    expect(Object.keys(metrics)).toEqual([providerModelMetricKey('prov_fast', 'fast')])
    expect(metrics[providerModelMetricKey('prov_fast', 'fast')]?.avgTtftMilliseconds).toBe(50)
  })

  it('成功尝试有多次时取第一次成功的那一次', () => {
    const metrics = calculateProviderModelMetrics([logOf('r1', [attemptOf('first', { ttftMilliseconds: 10 }), attemptOf('second', { ttftMilliseconds: 99 })])])

    expect(Object.keys(metrics)).toEqual([providerModelMetricKey('prov_first', 'first')])
  })
})

describe('calculateProviderModelMetrics 的聚合', () => {
  it('多条请求的样本数与 TPS 按总 Token 除总时长', () => {
    const metrics = calculateProviderModelMetrics([
      logOf('r1', [attemptOf('fast', { durationMilliseconds: 1_000 })], { outputTokens: 20 }),
      logOf('r2', [attemptOf('fast', { durationMilliseconds: 3_000 })], { outputTokens: 300 }),
    ])

    const entry = metrics[providerModelMetricKey('prov_fast', 'fast')]
    expect(entry?.sampleCount).toBe(2)
    // (20 + 300) / ((1000 + 3000) / 1000) = 80，而不是 (20 + 100) / 2 = 60：
    // 短响应不该跟长响应等权。
    expect(entry?.avgTps).toBe(80)
  })

  it('平均 TTFT 只对报出 TTFT 的那些尝试取平均', () => {
    const metrics = calculateProviderModelMetrics([
      logOf('r1', [attemptOf('fast', { ttftMilliseconds: 100 })]),
      logOf('r2', [attemptOf('fast', { ttftMilliseconds: 300 })]),
      logOf('r3', [attemptOf('fast', { ttftMilliseconds: null })]),
    ])

    const entry = metrics[providerModelMetricKey('prov_fast', 'fast')]
    // 三条都是样本，但只有两条参与 TTFT 平均。
    expect(entry?.sampleCount).toBe(3)
    expect(entry?.avgTtftMilliseconds).toBe(200)
  })

  it('一条 TTFT 都没有时是 null，而不是 0', () => {
    const metrics = calculateProviderModelMetrics([logOf('r1', [attemptOf('fast', { ttftMilliseconds: null })])])

    expect(metrics[providerModelMetricKey('prov_fast', 'fast')]?.avgTtftMilliseconds).toBeNull()
  })

  it('TTFT 恰好为 0 也算一条有效样本', () => {
    const metrics = calculateProviderModelMetrics([logOf('r1', [attemptOf('fast', { ttftMilliseconds: 0 })])])

    // 0 毫秒是「极快」，不是「没有数据」。
    expect(metrics[providerModelMetricKey('prov_fast', 'fast')]?.avgTtftMilliseconds).toBe(0)
  })

  it('没有输出 Token 或时长不整的样本算不出 TPS，退回 null', () => {
    const noTokens = calculateProviderModelMetrics([logOf('r1', [attemptOf('fast')], { outputTokens: null })])
    expect(noTokens[providerModelMetricKey('prov_fast', 'fast')]?.avgTps).toBeNull()

    const noDuration = calculateProviderModelMetrics([logOf('r1', [attemptOf('fast', { durationMilliseconds: 0 })])])
    expect(noDuration[providerModelMetricKey('prov_fast', 'fast')]?.avgTps).toBeNull()
  })

  // 分子分母必须来自同一批样本：不够格的那条整体剔除，不能只剔一半。
  it('不够格的样本分子分母一起剔，剩下的样本照常聚合', () => {
    const metrics = calculateProviderModelMetrics([
      logOf('r1', [attemptOf('fast', { durationMilliseconds: 1_000 })], { outputTokens: 50 }),
      logOf('r2', [attemptOf('fast', { durationMilliseconds: 1_000 })], { outputTokens: null }),
    ])

    const entry = metrics[providerModelMetricKey('prov_fast', 'fast')]
    expect(entry?.sampleCount).toBe(2)
    // 只有 r1 进分子分母：50 / 1s = 50；若把 r2 的时长也算进去会得到 25。
    expect(entry?.avgTps).toBe(50)
  })

  it('不同 provider 的同一个模型名分开统计', () => {
    const metrics = calculateProviderModelMetrics([
      logOf('r1', [attemptOf('gpt-4o', { providerId: 'prov_a', ttftMilliseconds: 10 })]),
      logOf('r2', [attemptOf('gpt-4o', { providerId: 'prov_b', ttftMilliseconds: 90 })]),
    ])

    expect(Object.keys(metrics).sort()).toEqual([providerModelMetricKey('prov_a', 'gpt-4o'), providerModelMetricKey('prov_b', 'gpt-4o')].sort())
    expect(metrics[providerModelMetricKey('prov_a', 'gpt-4o')]?.avgTtftMilliseconds).toBe(10)
    expect(metrics[providerModelMetricKey('prov_b', 'gpt-4o')]?.avgTtftMilliseconds).toBe(90)
  })

  // 同一条请求日志出现两次不该把样本数翻倍：`requestIds` 是 Set。
  it('请求 id 重复时样本数不翻倍', () => {
    const metrics = calculateProviderModelMetrics([logOf('r1', [attemptOf('fast')]), logOf('r1', [attemptOf('fast')])])

    const entry = metrics[providerModelMetricKey('prov_fast', 'fast')]
    expect(entry?.sampleCount).toBe(1)
    // TPS 是「总 Token 除总时长」，重复的样本在这条口径下会被算两遍——这里如实记录现状：
    // 输出仍是 100 / 1s = 100（重复条目的分子分母同增，比值不变）。
    expect(entry?.avgTps).toBe(100)
  })

  it('空输入给空结果，不是抛错', () => {
    expect(calculateProviderModelMetrics([])).toEqual({})
  })
})
