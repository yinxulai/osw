import type { AnalyticsRange, DailyTrendPoint } from '@common/schemas'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { CardSectionHeader } from '@/components/card-section-header'
import { formatTrendDescription } from '../lib/format'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const chartConfig = {
  success: { label: '成功' },
  failed: { label: '失败' },
} satisfies ChartConfig

interface TrendChartProps {
  trend: DailyTrendPoint[]
  range: AnalyticsRange
}

// X 轴刻度间隔：今日为 15 分钟槽，每 4 个槽（1 小时）显示一个标签；
// 近 7 天全部显示；近 30 天每 5 天显示一个。
function axisInterval(range: AnalyticsRange): number {
  if (range === 'today') return 3
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

function TrendTooltip(props: TrendTooltipProps) {
  const { active, label, payload, range } = props
  if (!active || !label || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <div className="rounded-lg bg-muted px-3 py-2 text-xs">
      <div className="font-medium">{formatTooltipLabel(label, range)}</div>
      <div className="mt-1.5 grid gap-1">
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-[2px] bg-success" />
            成功
          </span>
          <span className="font-mono font-medium tabular-nums">{point.success}</span>
        </div>
        {point.failed > 0 && (
          <div className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-[2px] bg-destructive" />
              失败
            </span>
            <span className="font-mono font-medium tabular-nums">{point.failed}</span>
          </div>
        )}
        <div className="mt-0.5 flex items-center justify-between gap-6 border-t border-border/50 pt-1">
          <span className="text-muted-foreground">合计</span>
          <span className="font-mono font-medium tabular-nums">{point.requests}</span>
        </div>
      </div>
    </div>
  )
}

export function TrendChart(props: TrendChartProps) {
  const { trend, range } = props

  return (
    <Card className="min-w-0 w-full">
      <CardSectionHeader title="请求量趋势" description={formatTrendDescription(range)} compact />
      <CardContent className="min-w-0">
        {trend.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
            暂无请求数据，产生代理请求后将显示趋势
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
                fontSize={11}
              />
              <Tooltip content={<TrendTooltip range={range} />} />
              <Bar dataKey="success" stackId="total" fill="var(--color-success)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="failed" stackId="total" fill="var(--color-destructive)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
