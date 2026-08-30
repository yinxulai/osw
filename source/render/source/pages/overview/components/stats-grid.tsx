import { BarChart3, CheckCircle2, Zap, Coins } from 'lucide-react'
import type { StatsSummary } from '@common/schemas'
import { MetricGrid } from '@/components/metric-grid'
import { NumberTicker } from '@/components/ui/number-ticker'

interface StatsGridProps {
  summary: StatsSummary
}

export function StatsGrid(props: StatsGridProps) {
  const { summary } = props

  return (
    <MetricGrid items={[
      { label: '总请求数', value: <NumberTicker value={summary.totalRequests} />, Icon: BarChart3 },
      { label: '成功率', value: <><NumberTicker value={summary.successRate * 100} decimalPlaces={1} />%</>, Icon: CheckCircle2 },
      { label: '平均响应', value: summary.avgLatencyMs < 1000 ? <><NumberTicker value={summary.avgLatencyMs} />ms</> : <><NumberTicker value={summary.avgLatencyMs / 1000} decimalPlaces={1} />s</>, Icon: Zap },
      { label: 'Token 消耗', value: summary.totalTokens >= 1_000_000 ? <><NumberTicker value={summary.totalTokens / 1_000_000} decimalPlaces={1} />M</> : summary.totalTokens >= 1_000 ? <><NumberTicker value={summary.totalTokens / 1_000} decimalPlaces={1} />K</> : <NumberTicker value={summary.totalTokens} />, Icon: Coins },
    ]} />
  )
}
