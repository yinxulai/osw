import type { LatencyBucket } from '@common/schemas'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface LatencyDistributionProps {
  buckets: LatencyBucket[]
}

export function LatencyDistribution({ buckets }: LatencyDistributionProps) {
  return (
    <Card className="min-w-[280px]">
      <CardHeader className="pb-1.5">
        <CardTitle className="text-sm">延迟分布</CardTitle>
        <CardDescription>响应时间区间占比</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        {buckets.map(l => (
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
