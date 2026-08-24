import { Boxes, Building2, CircleCheck, TimerReset } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import type { ProviderModelRoute } from '@common/schemas'

interface QueueSummaryProps {
  models: ProviderModelRoute[]
  isCooling: (providerId: string, providerModelId: string) => boolean
}

export function QueueSummary(props: QueueSummaryProps) {
  const enabledCount = props.models.filter(model => model.enabled).length
  const coolingCount = props.models.filter(model => props.isCooling(model.providerId, model.id)).length
  const providerCount = new Set(props.models.map(model => model.providerId)).size

  return (
    <MetricGrid items={[
      { label: '队列模型', value: props.models.length, Icon: Boxes, hint: '参与 default 路由' },
      { label: '已启用', value: enabledCount, Icon: CircleCheck, hint: '可参与请求调度' },
      { label: '冷却中', value: coolingCount, Icon: TimerReset, hint: coolingCount ? '等待故障冷却结束' : '当前没有冷却模型' },
      { label: '接入供应商', value: providerCount, Icon: Building2, hint: '当前队列覆盖范围' },
    ]} />
  )
}
