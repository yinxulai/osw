import { BarChart3, CheckCircle2, Zap, Coins } from 'lucide-react'
import type { StatsSummary } from '@common/schemas'
import { formatLatency, formatTokens } from '../lib/format'

interface StatsGridProps {
  summary: StatsSummary
}

export function StatsGrid(props: StatsGridProps) {
  const { summary } = props

  const stats = [
    { label: '总请求数', value: summary.totalRequests.toLocaleString(), Icon: BarChart3 },
    { label: '成功率', value: `${(summary.successRate * 100).toFixed(1)}%`, Icon: CheckCircle2 },
    { label: '平均响应', value: formatLatency(summary.avgLatencyMs), Icon: Zap },
    { label: 'Token 消耗', value: formatTokens(summary.totalTokens), Icon: Coins },
  ]

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="min-w-[140px] bg-card p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <s.Icon size={13} />
            {s.label}
          </div>
          <div className="text-xl font-medium tabular-nums">{s.value}</div>
        </div>
      ))}
    </div>
  )
}
