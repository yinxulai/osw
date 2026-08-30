import type { AnalyticsRange, DailyTrendPoint } from '@common/schemas'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { CardSectionHeader } from '@/components/card-section-header'
import { formatTokens, formatTrendDescription } from '../lib/format'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const chartConfig = {
  inputTokens: { label: '输入', color: 'hsl(var(--success))' },
  outputTokens: { label: '输出', color: '#0891b2' },
  reasoningTokens: { label: '思考', color: '#64748b' },
  cachedInputTokens: { label: '缓存读取', color: '#14b8a6' },
  cacheCreationInputTokens: { label: '缓存写入', color: '#f59e0b' },
} satisfies ChartConfig

interface TrendChartProps {
  trend: DailyTrendPoint[]
  range: AnalyticsRange
}

// X 轴刻度只控制标签密度，不影响 15 分钟粒度的数据和 Tooltip；
// 今日每 2 小时显示一个标签，近 7 天全部显示，近 30 天每 5 天显示一个。
function axisInterval(range: AnalyticsRange): number {
  if (range === 'today') return 7
  if (range === '7d') return 0
  return 4
}

function formatAxisTick(label: string, range: AnalyticsRange): string {
  if (range === 'today') return label
  const d = new Date(label)
  if (range === '7d') return WEEKDAYS[d.getDay()] ?? ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatTooltipLabel(label: string, range: AnalyticsRange): string {
  if (range === 'today') return label
  const d = new Date(label)
  const date = `${d.getMonth() + 1}月${d.getDate()}日`
  return range === '7d' ? `${date} ${WEEKDAYS[d.getDay()] ?? ''}` : date
}

interface TrendTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: DailyTrendPoint }>
  range: AnalyticsRange
}

// Tooltip 按阅读顺序展示；柱状图按从底到顶反向排列，使输入位于最上层。
const USAGE_ITEMS = [
  ['inputTokens', '输入'],
  ['cachedInputTokens', '缓存读取'],
  ['cacheCreationInputTokens', '缓存写入'],
  ['outputTokens', '输出'],
  ['reasoningTokens', '思考'],
] as const

const STACK_ITEMS = [...USAGE_ITEMS].reverse()

function TrendTooltip(props: TrendTooltipProps) {
  const { active, label, payload, range } = props
  if (!active || !label || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <div className="rounded-lg bg-muted px-3 py-2 text-xs">
      <div className="font-medium">{formatTooltipLabel(label, range)}</div>
      <div className="mt-1.5 grid gap-1">
        {USAGE_ITEMS.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-6">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-medium tabular-nums">{formatTokens(point[key])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TrendChart(props: TrendChartProps) {
  const { trend, range } = props

  return (
    <Card className="min-w-0 w-full">
      <CardSectionHeader title="用量分布" description={formatTrendDescription(range)} compact />
      <CardContent className="min-w-0">
        {trend.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
            暂无使用量数据，产生代理请求后将显示趋势
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-44 w-full">
            <BarChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={axisInterval(range)}
                tickFormatter={value => formatAxisTick(String(value), range)}
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
              <Tooltip content={<TrendTooltip range={range} />} />
              {STACK_ITEMS.map(([key], index) => (
                <Bar key={key} dataKey={key} stackId="usage" fill={`var(--color-${key})`} radius={index === STACK_ITEMS.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
