import type { UsageTrendPoint } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { formatTrendTickLabel, formatTrendTooltipLabel, resolveTrendTicks, trendCrossesDays, TREND_MAX_TICKS } from '@common/analytics-buckets'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { CardSectionHeader } from '@/components/card-section-header'
import { useLocale, useTranslation, type AppTranslator } from '@/i18n/provider'
import { formatTokens, formatIntervalDescription } from '../lib/format'
import { disjointTrendPoint, type TrendBarPoint } from '../lib/trend-bars'

function buildChartConfig(t: AppTranslator): ChartConfig {
  return {
    inputTokens: { label: t('overview.trend.input'), color: 'hsl(var(--success))' },
    outputTokens: { label: t('overview.trend.output'), color: '#0891b2' },
    reasoningTokens: { label: t('overview.trend.reasoning'), color: '#64748b' },
    cachedInputTokens: { label: t('overview.trend.cacheRead'), color: '#14b8a6' },
    cacheCreationInputTokens: { label: t('overview.trend.cacheWrite'), color: '#f59e0b' },
  }
}

interface TrendBarsProps {
  trend: UsageTrendPoint[]
}

interface TrendChartProps extends TrendBarsProps {
  /** 每根柱子覆盖的时长，由查询范围推导（`AnalyticsSummary.trendIntervalMs`）。 */
  trendIntervalMs: number
}

interface TrendTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: UsageTrendPoint }>
  crossesDays: boolean
}

// Tooltip 按阅读顺序展示落库总量；柱状图从底到顶排互不相交的段，使未缓存输入位于最上层。
const USAGE_ITEMS = [
  ['inputTokens', 'overview.trend.input'],
  ['cachedInputTokens', 'overview.trend.cacheRead'],
  ['cacheCreationInputTokens', 'overview.trend.cacheWrite'],
  ['outputTokens', 'overview.trend.output'],
  ['reasoningTokens', 'overview.trend.reasoning'],
] as const satisfies ReadonlyArray<readonly [keyof UsageTrendPoint, UiCatalogKey]>

const STACK_SERIES = [
  { key: 'reasoningTokens', color: 'reasoningTokens' },
  { key: 'plainOutputTokens', color: 'outputTokens' },
  { key: 'cacheCreationInputTokens', color: 'cacheCreationInputTokens' },
  { key: 'cachedInputTokens', color: 'cachedInputTokens' },
  { key: 'uncachedInputTokens', color: 'inputTokens' },
] as const satisfies ReadonlyArray<{ key: keyof TrendBarPoint; color: keyof UsageTrendPoint }>

function TrendTooltip(props: TrendTooltipProps) {
  const { active, label, payload, crossesDays } = props
  const t = useTranslation()
  const locale = useLocale()
  if (!active || !label || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <div className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 py-2 system-xs-regular backdrop-blur-[5px]">
      <div className="system-xs-medium text-text-primary">{formatTrendTooltipLabel(locale, label, crossesDays)}</div>
      <div className="mt-1.5 grid gap-1">
        {USAGE_ITEMS.map(([key, labelKey]) => (
          <div key={key} className="flex items-center justify-between gap-6">
            <span className="text-text-tertiary">{t(labelKey)}</span>
            <span className="font-mono system-xs-medium tabular-nums text-text-primary">{formatTokens(point[key])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 柱状图本体，不含卡片外壳。
 *
 * 分析页的「用量分布」把它当作热力图的另一种模式，卡片头与模式切换由 `UsageDistribution`
 * 统一给；供应商下钻页用下面包好外壳的 `TrendChart`。
 */
export function TrendBars(props: TrendBarsProps) {
  const { trend } = props
  const t = useTranslation()
  const locale = useLocale()
  // 首尾标签落在同一天时不写日期：今天的每小时不必把日期重复一遍。
  const crossesDays = trendCrossesDays(trend.map(point => point.label))
  // 刻度不在这里算：挑哪几格由 `@common/analytics-buckets` 定，
  // 否则「柱子变细了但刻度还按根数等距抽」会抽出每 21 小时一格这种位置。
  const ticks = resolveTrendTicks(trend.map(point => point.label), TREND_MAX_TICKS)

  if (trend.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center system-xs-regular text-text-tertiary">
        {t('overview.trend.empty')}
      </div>
    )
  }

  return (
    <ChartContainer config={buildChartConfig(t)} className="aspect-auto h-44 w-full">
      <BarChart data={trend.map(disjointTrendPoint)} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          ticks={ticks}
          interval={0}
          tickFormatter={value => formatTrendTickLabel(locale, String(value), crossesDays)}
          fontSize={11}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          allowDecimals={false}
          tickFormatter={value => formatTokens(Number(value))}
          fontSize={11}
        />
        <Tooltip content={<TrendTooltip crossesDays={crossesDays} />} />
        {STACK_SERIES.map(({ key, color }, index) => (
          <Bar key={key} dataKey={key} stackId="usage" fill={`var(--color-${color})`} radius={index === STACK_SERIES.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

export function TrendChart(props: TrendChartProps) {
  const { trend, trendIntervalMs } = props
  const t = useTranslation()

  return (
    <Card className="min-w-0 w-full">
      <CardSectionHeader title={t('overview.trend.title')} description={formatIntervalDescription(t, trendIntervalMs)} compact />
      <CardContent className="min-w-0">
        <TrendBars trend={trend} />
      </CardContent>
    </Card>
  )
}
