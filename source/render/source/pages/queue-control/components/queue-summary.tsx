import { Activity, Clock3, Layers3, Zap } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import type { ProviderModelRoute } from '@common/schemas'
import type { QueueSummaryMetrics } from '../lib/model-metrics'

interface QueueSummaryProps {
  models: ProviderModelRoute[]
  summaryMetrics?: QueueSummaryMetrics
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`
}

function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds == null) return '—'
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${Math.round(milliseconds)}ms`
}

function formatTps(value: number | null | undefined): string {
  return value == null ? '—' : value >= 10 ? String(Math.round(value)) : value.toFixed(1)
}

export function QueueSummary(props: QueueSummaryProps) {
  const enabledCount = props.models.filter(model => model.enabled).length
  const metrics = props.summaryMetrics

  return (
    <MetricGrid items={[
      { label: '请求成功率', value: formatPercent(metrics?.successRate), Icon: Activity, hint: metrics ? `近 ${metrics.completedRequestCount} 次已完成请求` : '等待请求数据' },
      { label: '平均响应耗时', value: formatDuration(metrics?.avgDurationMilliseconds), Icon: Clock3, hint: '成功请求的完整返回耗时' },
      { label: '平均 TPS', value: formatTps(metrics?.avgTps), Icon: Zap, hint: '输出 Token ÷ 总耗时' },
      { label: '当前可用模型', value: `${enabledCount} / ${props.models.length}`, Icon: Layers3, hint: metrics?.failoverCount ? `近 ${metrics.failoverCount} 次发生故障转移` : '当前没有故障转移' },
    ]} />
  )
}
