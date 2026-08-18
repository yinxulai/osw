import type { AnalyticsRange, DailyTrendPoint } from '@common/schemas'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDayLabel } from '../lib/format'

interface TrendChartProps {
  trend: DailyTrendPoint[]
  range: AnalyticsRange
}

export function TrendChart(props: TrendChartProps) {
  const { trend, range } = props

  const maxRequests = Math.max(1, ...trend.map(d => d.requests))

  return (
    <Card className="min-w-[400px]">
      <CardHeader className="pb-1.5">
        <CardTitle className="text-sm">请求量趋势</CardTitle>
        <CardDescription>每日请求数</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-40 flex items-end gap-2 pt-2">
          {trend.map(d => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="w-full flex flex-col-reverse h-32 gap-0.5">
                <div
                  className="w-full bg-primary/80 rounded-t-sm transition-all"
                  style={{ height: `${(d.requests / maxRequests) * 100}%`, minHeight: 3 }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground">{formatDayLabel(d.day, range)}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
