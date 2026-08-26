import type { AnalyticsRange } from '@common/schemas'

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

export function formatDayLabel(day: string, range: AnalyticsRange): string {
  // 今日粒度下 label 为 HH:mm（15 分钟槽，仅对整点时刻显示标签避免拥挤）
  if (range === 'today') {
    if (day.endsWith(':00')) return day
    return ''
  }
  const d = new Date(day)
  if (range === '7d') {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return weekdays[d.getDay()]
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function formatTrendDescription(range: AnalyticsRange): string {
  return range === 'today' ? '15 分钟粒度请求数' : '每日请求数'
}

export const PROVIDER_COLORS = [
  'bg-emerald-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-zinc-700',
  'bg-rose-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-teal-500',
]

export function getProviderColor(index: number): string {
  return PROVIDER_COLORS[index % PROVIDER_COLORS.length]
}
