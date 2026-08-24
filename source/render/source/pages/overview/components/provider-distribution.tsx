import type { ProviderStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { getProviderColor } from '../lib/format'

interface ProviderDistributionProps {
  stats: ProviderStat[]
}

export function ProviderDistribution(props: ProviderDistributionProps) {
  const { stats } = props

  return (
    <Card className="min-w-70">
      <CardSectionHeader title="供应商分布" description="按请求量统计" compact />
      <CardContent className="space-y-2.5 pt-1">
        {stats.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center text-xs text-muted-foreground">
            暂无供应商请求数据
          </div>
        ) : stats.map((p, idx) => (
          <div key={p.providerId}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium">{p.providerName}</span>
              <span className="text-muted-foreground tabular-nums">
                {p.percent}% · {p.requests.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full', getProviderColor(idx))} style={{ width: `${p.percent}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
