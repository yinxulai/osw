import type { AnalyticsRange, DailyTrendPoint, ProviderStat } from '@common/schemas'

// 原型阶段：后端尚未提供供应商维度的时间序列聚合，
// 这里基于供应商汇总数据生成确定性的演示趋势，保证每次渲染一致。
// 接入真实接口后，此文件可整体替换为 API 数据映射。

function seededRandom(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function hashString(str: string): number {
  let hash = 7
  for (let i = 0; i < str.length; i++) {
    hash = hash * 31 + str.charCodeAt(i)
    hash = hash % 1000000007
  }
  return hash
}

export interface ProviderRequestTrendPoint {
  label: string
  requests: number
  success: number
  failed: number
  successRate: number
  avgLatencyMs: number
}

export interface ProviderSparkPoint {
  value: number
  highlight: boolean
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function buildLabels(range: AnalyticsRange): string[] {
  const now = new Date()
  if (range === 'today') {
    // 每 2 小时一个点，共 12 个
    return Array.from({ length: 12 }, (_, i) => {
      const h = i * 2
      return `${String(h).padStart(2, '0')}:00`
    })
  }
  const days = range === '7d' ? 7 : 30
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (days - 1 - i))
    if (range === '7d') return WEEKDAYS[d.getDay()] ?? ''
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
}

/** 按权重把总量分配到各个时间点，权重带随机波动 */
function distribute(total: number, points: number, rand: () => number, minRatio = 0.3): number[] {
  const weights = Array.from({ length: points }, () => minRatio + rand() * (1 - minRatio))
  // 周末略低、近期略高，让趋势更自然
  weights.forEach((w, i) => {
    const recencyBoost = 1 + (i / points) * 0.4
    weights[i] = w * recencyBoost
  })
  const sum = weights.reduce((a, b) => a + b, 0)
  const values = weights.map(w => Math.round((w / sum) * total))
  // 修正舍入误差，差额补到最大值
  const diff = total - values.reduce((a, b) => a + b, 0)
  if (diff !== 0) {
    const maxIdx = values.indexOf(Math.max(...values))
    values[maxIdx] = Math.max(0, values[maxIdx] + diff)
  }
  return values
}

export function getProviderRequestTrend(provider: ProviderStat, range: AnalyticsRange): ProviderRequestTrendPoint[] {
  const rand = seededRandom(hashString(provider.providerId + range))
  const labels = buildLabels(range)
  const requestValues = distribute(provider.requests, labels.length, rand)
  const failedValues = distribute(provider.failed, labels.length, rand, 0)
  const baseLatency = provider.avgLatencyMs

  return labels.map((label, i) => {
    const requests = requestValues[i] ?? 0
    const failed = Math.min(failedValues[i] ?? 0, requests)
    const success = requests - failed
    const latencyJitter = 0.75 + rand() * 0.5
    return {
      label,
      requests,
      success,
      failed,
      successRate: requests > 0 ? success / requests : 1,
      avgLatencyMs: Math.round(baseLatency * latencyJitter),
    }
  })
}

export function getProviderTokenTrend(provider: ProviderStat, range: AnalyticsRange): DailyTrendPoint[] {
  const rand = seededRandom(hashString(provider.providerId + 'token' + range))
  const labels = buildLabels(range)
  // 原型：用请求数估算 token 量级（每请求约 3k~8k token）
  const perRequestTokens = 3000 + Math.floor(rand() * 5000)
  const totalTokens = provider.requests * perRequestTokens
  const totalValues = distribute(totalTokens, labels.length, rand)

  return labels.map((label, i) => {
    const total = totalValues[i] ?? 0
    const inputRatio = 0.45 + rand() * 0.1
    const outputRatio = 0.2 + rand() * 0.1
    const cachedRatio = 0.1 + rand() * 0.15
    const cacheCreateRatio = 0.05 + rand() * 0.05
    const reasoningRatio = Math.max(0, 1 - inputRatio - outputRatio - cachedRatio - cacheCreateRatio)
    return {
      label,
      inputTokens: Math.round(total * inputRatio),
      outputTokens: Math.round(total * outputRatio),
      cachedInputTokens: Math.round(total * cachedRatio),
      cacheCreationInputTokens: Math.round(total * cacheCreateRatio),
      reasoningTokens: Math.round(total * reasoningRatio),
    }
  })
}

/** 卡片用的迷你 sparkline 数据（近 7 个点） */
export function getProviderSparkline(provider: ProviderStat): ProviderSparkPoint[] {
  const rand = seededRandom(hashString(provider.providerId + 'spark'))
  const values = Array.from({ length: 7 }, () => 0.35 + rand() * 0.65)
  const max = Math.max(...values)
  return values.map((v, i) => ({ value: v / max, highlight: i === values.length - 1 }))
}
