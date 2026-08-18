import type { ProviderStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getProviderColor } from '../lib/format'

interface ProviderDistributionProps {
  stats: ProviderStat[]
}

export function ProviderDistribution({ stats }: ProviderDistributionProps) {
  return (
    <Card className="min-w-[280px]">
      <CardHeader className="pb-1.5">
        <CardTitle className="text-sm">供应商分布</CardTitle>
        <CardDescription>按请求量占比</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-1">
        {stats.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">暂无数据</div>
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
