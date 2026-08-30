import { Activity, Clock3, Layers3, Zap } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import { NumberTicker } from '@/components/ui/number-ticker'
import type { ProviderModelRoute } from '@common/schemas'
import type { QueueSummaryMetrics } from '../lib/model-metrics'

interface QueueSummaryProps {
  models: ProviderModelRoute[]
  summaryMetrics?: QueueSummaryMetrics
}

type TickerValueProps = {
  value: number | null | undefined
  decimalPlaces?: number
  suffix?: string
}

function TickerValue(props: TickerValueProps) {
  if (props.value == null) return <>—</>
  return <><NumberTicker value={props.value} decimalPlaces={props.decimalPlaces} />{props.suffix}</>
}

export function QueueSummary(props: QueueSummaryProps) {
  const enabledCount = props.models.filter(model => model.enabled).length
  const metrics = props.summaryMetrics

  return (
    <MetricGrid items={[
      { label: '请求成功率', value: metrics?.successRate == null ? '—' : <><TickerValue value={metrics.successRate * 100} decimalPlaces={1} suffix="%" /></>, Icon: Activity, hint: metrics ? <>近 <TickerValue value={metrics.completedRequestCount} /> 次已完成请求</> : '等待请求数据' },
      { label: '平均响应耗时', value: metrics?.avgDurationMilliseconds == null ? '—' : <><TickerValue value={metrics.avgDurationMilliseconds >= 1000 ? metrics.avgDurationMilliseconds / 1000 : metrics.avgDurationMilliseconds} decimalPlaces={metrics.avgDurationMilliseconds >= 1000 ? 1 : 0} suffix={metrics.avgDurationMilliseconds >= 1000 ? 's' : 'ms'} /></>, Icon: Clock3, hint: '成功请求的完整返回耗时' },
      { label: '平均 TPS', value: metrics?.avgTps == null ? '—' : <TickerValue value={metrics.avgTps} decimalPlaces={metrics.avgTps >= 10 ? 0 : 1} />, Icon: Zap, hint: '输出 Token ÷ 总耗时' },
      { label: '当前可用模型', value: <><TickerValue value={enabledCount} /> / <TickerValue value={props.models.length} /></>, Icon: Layers3, hint: metrics?.failoverCount ? <>近 <TickerValue value={metrics.failoverCount} /> 次发生故障转移</> : '当前没有故障转移' },
    ]} />
  )
}
