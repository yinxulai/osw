import type { AnalyticsRange, DailyTrendPoint } from '@common/schemas'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { formatDayLabel, formatTrendDescription } from '../lib/format'

interface TrendChartProps {
  trend: DailyTrendPoint[]
  range: AnalyticsRange
}

export function TrendChart(props: TrendChartProps) {
  const { trend, range } = props

  const maxRequests = Math.max(1, ...trend.map(d => d.requests))

  return (
    <Card className="min-w-0 w-full">
      <CardSectionHeader title="请求量趋势" description={formatTrendDescription(range)} compact />
      <CardContent className="min-w-0 overflow-hidden">
        <div className="h-40 flex min-w-0 items-end gap-0.5 pt-2 sm:gap-1">
          {trend.length === 0 ? (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              暂无请求数据，产生代理请求后将显示趋势
            </div>
          ) : trend.map(d => (
            <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="w-full flex flex-col-reverse h-32 gap-0.5">
                <div
                  className="w-full bg-primary/80 rounded-t-sm transition-all"
                  style={{ height: `${(d.requests / maxRequests) * 100}%`, minHeight: 3 }}
                />
              </div>
              <div className="w-full truncate text-center text-[10px] text-muted-foreground sm:text-[11px]">{formatDayLabel(d.label, range)}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
