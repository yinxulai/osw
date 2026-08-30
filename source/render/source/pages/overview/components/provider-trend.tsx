import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'
import type { ProviderStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { getProviderColor } from '../lib/format'
import { getProviderSparkline } from '../lib/provider-mock'

interface ProviderTrendProps {
  stats: ProviderStat[]
  onSelectProvider: (provider: ProviderStat) => void
}

export function ProviderTrend(props: ProviderTrendProps) {
  const visibleStats = props.stats.slice(0, 5)

  return (
    <Card className="min-w-0 cursor-pointer transition-colors hover:bg-muted/20">
      <CardSectionHeader
        title="供应商趋势"
        description="按请求量查看近期变化"
        compact
        actions={<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />}
      />
      <CardContent className="space-y-2.5 pt-1">
        {visibleStats.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center text-xs text-muted-foreground">
            暂无供应商请求数据
          </div>
        ) : visibleStats.map((provider, idx) => {
          const points = getProviderSparkline(provider)
          const latestPoint = points[points.length - 1]?.value ?? 0
          const firstPoint = points[0]?.value ?? 0
          const trendUp = latestPoint >= firstPoint
          return (
            <button
              key={provider.providerId}
              type="button"
              className="group flex w-full items-center gap-2 text-left"
              onClick={() => props.onSelectProvider(provider)}
              aria-label={`查看 ${provider.providerName} 数据分析`}
            >
              <span className={cn('size-2 shrink-0 rounded-full', getProviderColor(idx))} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{provider.providerName}</span>
              <span className="flex h-5 items-end gap-0.5" aria-hidden="true">
                {points.map((point, pointIdx) => (
                  <span
                    key={pointIdx}
                    className={cn('w-1 rounded-sm bg-foreground/20', point.highlight && 'bg-foreground/70')}
                    style={{ height: `${Math.max(4, point.value * 18)}px` }}
                  />
                ))}
              </span>
              <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">{provider.percent}%</span>
              {trendUp ? <TrendingUp className="size-3.5 text-success" /> : <TrendingDown className="size-3.5 text-muted-foreground" />}
            </button>
          )
        })}
        {props.stats.length > visibleStats.length && (
          <div className="pt-1 text-[11px] text-muted-foreground">还有 {props.stats.length - visibleStats.length} 个供应商</div>
        )}
      </CardContent>
    </Card>
  )
}
