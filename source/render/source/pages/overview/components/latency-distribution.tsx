import type { LatencyBucket } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'

interface LatencyDistributionProps {
  buckets: LatencyBucket[]
}

export function LatencyDistribution(props: LatencyDistributionProps) {
  const { buckets } = props

  return (
    <Card className="min-w-70">
      <CardSectionHeader title="TTFT 分布" description="首字延迟区间" compact />
      <CardContent className="space-y-2 pt-1">
        {buckets.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center text-xs text-muted-foreground">
            暂无 TTFT 数据
          </div>
        ) : buckets.map(l => (
          <div key={l.range} className="flex items-center gap-2">
            <div className="w-10 text-[11px] text-muted-foreground shrink-0">{l.range}</div>
            <div className="flex-1 relative h-5 bg-muted rounded-sm overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-sm',
                  l.percent > 30 ? 'bg-success' : l.percent > 10 ? 'bg-warning' : 'bg-destructive'
                )}
                style={{ width: `${l.percent}%` }}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums">
                {l.percent}%
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
