import { BarChart3, CheckCircle2, Zap, Coins } from 'lucide-react'
import type { StatsSummary } from '@common/schemas'
import { cn } from '@/lib/utils'
import { formatLatency, formatTokens } from '../lib/format'

interface StatsGridProps {
  summary: StatsSummary
}

export function StatsGrid({ summary }: StatsGridProps) {
  const stats = [
    { label: '总请求数', value: summary.totalRequests.toLocaleString(), Icon: BarChart3 },
    { label: '成功率', value: `${(summary.successRate * 100).toFixed(1)}%`, Icon: CheckCircle2 },
    { label: '平均响应', value: formatLatency(summary.avgLatencyMs), Icon: Zap },
    { label: 'Token 消耗', value: formatTokens(summary.totalTokens), Icon: Coins },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 rounded-md border">
      {stats.map((s, idx) => (
        <div
          key={s.label}
          className={cn(
            'p-3',
            idx < stats.length - 1 && 'border-r',
            idx >= 2 && 'border-t sm:border-t-0'
          )}
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <s.Icon size={13} />
            {s.label}
          </div>
          <div className="text-xl font-semibold tabular-nums">{s.value}</div>
        </div>
      ))}
    </div>
  )
}
