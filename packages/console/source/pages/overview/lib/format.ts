import { resolveAnalyticsBuckets, trendIntervalParts } from '@common/analytics-buckets'
import type { AnalyticsRange } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

/**
 * 账单上的 Token 数：**只取整**，不保留小数。
 *
 * 账单是给外人看的累计量，出现「1.4M」这种带小数的值会显得像估算；
 * K/M 两档同样先四舍五入到整数再拼单位，保证任何一行都是一串干净的整数。
 */
export function formatBillTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${Math.round(tokens)}`
}

/**
 * 百分比：固定一位小数。
 *
 * 实现在 `@/lib/format-percent`：请求详情那排指标格要报缓存命中率，那个比率不能在这里
 * 有一份、在那里再写一份（同一个数在两页写成不同小数位，就是两个数）。
 */
export { formatPercent } from '@/lib/format-percent'

/** 与 `formatCount` 同理：账单上的千分位也要跟随界面语言，不能用运行时默认语言。 */
export function formatBillCount(locale: string, value: number): string {
  return new Intl.NumberFormat(locale).format(value)
}

function formatBillDateTime(locale: string, value: Date) {
  return value.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * 账单抬头上的数据区间。
 *
 * 起点跟统计查询是同一扇窗（`resolveAnalyticsBuckets`）：`today` 从本地零点起，
 * `7d` / `30d` 从打印时刻往前推 7 或 30 个 24 小时。用日历日零点会把起点印晚将近一天，
 * Token 合计却仍按更早的那一窗算。终点就是这次的打印时刻。
 */
export function formatBillRangeLabel(locale: string, range: AnalyticsRange, endAt: Date): string {
  const end = new Date(endAt)
  const start = new Date(resolveAnalyticsBuckets(range, endAt.getTime()).sinceMs)

  return `${formatBillDateTime(locale, start)} - ${formatBillDateTime(locale, end)}`
}

/** 千分位分隔必须跟随界面语言，不能用运行时默认语言。 */
export function formatCount(locale: string, value: number): string {
  return value.toLocaleString(locale)
}

/**
 * 把桶宽翻成人话（趋势图与用量分布图共用的副标题）。
 *
 * 粒度是服务端从查询范围推出来的并随范围返回，界面不解一遍「今天 / 7 天 / 30 天」：
 * 各处分别推导就一定会有一处忘了改。两张图共用一套桶，所以也共用这一句。
 *
 * 桶宽缺失时返回 `null`（卡片头就不写这一句）：这个字段是随响应来的，界面比服务端新
 * 的那段时间里它可能没有值，那时说「每 NaN 分钟」比不说更糟。
 */
export function formatIntervalDescription(t: AppTranslator, trendIntervalMs: number): string | null {
  const parts = trendIntervalParts(trendIntervalMs)
  if (!parts) return null
  const { unit, count } = parts
  if (unit === 'day') return t('overview.trend.description.daily')
  if (unit === 'hour') return count === 1 ? t('overview.trend.description.hourly') : t('overview.trend.description.everyHour', { count })
  return t('overview.trend.description.everyMinute', { count })
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
