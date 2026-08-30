import { ChevronRight } from 'lucide-react'
import type { ProviderStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { getProviderColor } from '../lib/format'

interface ProviderDistributionProps {
  stats: ProviderStat[]
  onSelectProvider?: (provider: ProviderStat) => void
}

export function ProviderDistribution(props: ProviderDistributionProps) {
  const { stats } = props

  return (
    <Card className="min-w-70">
      <CardSectionHeader title="供应商分布" description="按实际调用次数统计" compact />
      <CardContent className="space-y-2.5 pt-1">
        {stats.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center text-xs text-muted-foreground">
            暂无供应商调用数据
          </div>
        ) : stats.map((p, idx) => (
          <button
            key={p.providerId}
            type="button"
            className="group w-full text-left"
            onClick={() => props.onSelectProvider?.(p)}
            disabled={!props.onSelectProvider}
            aria-label={props.onSelectProvider ? `查看 ${p.providerName} 数据分析` : undefined}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <span className={cn('size-2 shrink-0 rounded-full', getProviderColor(idx))} />
                <span className="truncate">{p.providerName}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums">
                {p.percent}% · {p.requests.toLocaleString()}
                {props.onSelectProvider && <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full', getProviderColor(idx))} style={{ width: `${p.percent}%` }} />
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}
