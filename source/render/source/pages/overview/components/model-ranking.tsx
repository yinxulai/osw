import type { ModelStat } from '@common/schemas'
import { tableCellClass, tableHeaderCellClass, tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatLatency } from '../lib/format'

interface ModelRankingProps {
  stats: ModelStat[]
}

export function ModelRanking(props: ModelRankingProps) {
  const { stats } = props

  return (
    <Card className="w-full">
      <CardSectionHeader title="模型使用排行" description="按请求量排序" compact />
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={tableHeaderClass}>
              <tr>
                <th className={cn(tableHeaderCellClass, 'w-8 px-4')}>#</th>
                <th className={tableHeaderCellClass}>模型</th>
                <th className={tableHeaderCellClass}>Provider</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>请求数</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>平均延迟</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>平均 TTFT</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>平均 TPS</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>缓存命中率</th>
                <th className={cn(tableHeaderCellClass, 'px-4 text-right')}>成功率</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-muted-foreground">
                    暂无模型请求数据
                  </td>
                </tr>
              ) : stats.map((m, idx) => (
                <tr key={m.providerModelId} className={tableRowClass}>
                  <td className={cn(tableCellClass, 'px-4')}>
                    <span className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium',
                      idx < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}>
                      {idx + 1}
                    </span>
                  </td>
                  <td className={cn(tableCellClass, 'font-medium')}>{m.providerModelName}</td>
                  <td className={cn(tableCellClass, 'text-muted-foreground')}>{m.providerName}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{m.requests.toLocaleString()}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatLatency(m.avgLatencyMs)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{m.avgTtftMs == null ? '—' : formatLatency(m.avgTtftMs)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{m.avgTps == null ? '—' : m.avgTps.toFixed(1)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{m.cacheHitRate == null ? '—' : `${(m.cacheHitRate * 100).toFixed(1)}%`}</td>
                  <td className={cn(tableCellClass, 'px-4 text-right')}>
                    <Badge variant={m.successRate >= 0.95 ? 'success' : m.successRate >= 0.8 ? 'warning' : 'destructive'} className="font-normal h-5 px-1.5 text-[11px]">
                      {(m.successRate * 100).toFixed(1)}%
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
