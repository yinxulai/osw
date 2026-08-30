import type { LatencyBucket } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'

const TTFT_BUCKET_COLORS = ['bg-success', 'bg-lime-500', 'bg-warning', 'bg-orange-500', 'bg-destructive'] as const

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
        ) : (
          <>
            {buckets.map((bucket, index) => (
              <div key={bucket.range} className="flex items-center gap-2">
                <div className="w-10 shrink-0 text-[11px] text-muted-foreground">{bucket.range}</div>
                <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className={cn('h-full rounded-sm', TTFT_BUCKET_COLORS[index] ?? 'bg-destructive')}
                    style={{ width: `${bucket.percent}%` }}
                    role="progressbar"
                    aria-label={`${bucket.range} TTFT 占比`}
                    aria-valuenow={bucket.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums">
                    {bucket.percent}%
                  </span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-end gap-1.5 pt-1 text-[10px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
              <span>快</span>
              <span className="mx-0.5 text-muted-foreground/50">→</span>
              <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
              <span>慢</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
