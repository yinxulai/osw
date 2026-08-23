import { BarChart3, CheckCircle2, Zap, Coins } from 'lucide-react'
import type { StatsSummary } from '@common/schemas'
import { MetricGrid } from '@/components/metric-grid'
import { formatLatency, formatTokens } from '../lib/format'

interface StatsGridProps {
  summary: StatsSummary
}

export function StatsGrid(props: StatsGridProps) {
  const { summary } = props

  return (
    <MetricGrid items={[
      { label: '总请求数', value: summary.totalRequests.toLocaleString(), Icon: BarChart3 },
      { label: '成功率', value: `${(summary.successRate * 100).toFixed(1)}%`, Icon: CheckCircle2 },
      { label: '平均响应', value: formatLatency(summary.avgLatencyMs), Icon: Zap },
      { label: 'Token 消耗', value: formatTokens(summary.totalTokens), Icon: Coins },
    ]} />
  )
}
