import { BarChart3, CheckCircle2, Clock3, Coins, TriangleAlert } from 'lucide-react'
import type { AnalyticsRange, ProviderAnalyticsDetail } from '@common/schemas'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { MetricGrid } from '@/components/metric-grid'
import { Badge } from '@/components/ui/badge'
import { formatLatency, formatTokens } from '../lib/format'
import { FailureReasons } from './failure-reasons'
import { LatencyDistribution } from './latency-distribution'
import { TrendChart } from './trend-chart'

interface ProviderDetailProps {
  detail: ProviderAnalyticsDetail
  range: AnalyticsRange
}

export function ProviderDetail(props: ProviderDetailProps) {
  const { summary, models: providerModels } = props.detail
  const hasSuccessfulCalls = summary.success > 0

  return (
    <div className="space-y-4">
      <MetricGrid className="sm:grid-cols-5" items={[
        { label: '调用数', value: summary.requests.toLocaleString(), Icon: BarChart3 },
        { label: '调用成功率', value: `${(summary.successRate * 100).toFixed(1)}%`, Icon: CheckCircle2 },
        { label: '失败调用', value: summary.failed.toLocaleString(), Icon: TriangleAlert },
        { label: '平均延迟', value: hasSuccessfulCalls ? formatLatency(summary.avgLatencyMs) : '—', Icon: Clock3 },
        { label: '用量', value: formatTokens(summary.totalTokens), Icon: Coins },
      ]} />

      <Card>
        <CardSectionHeader title="模型表现" description="按调用量排序 · 用于定位具体模型的质量与缓存差异" compact />
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">模型</th><th className="px-3 py-2 text-right font-medium">调用数</th><th className="px-3 py-2 text-right font-medium">平均延迟</th><th className="px-3 py-2 text-right font-medium">平均 TTFT</th><th className="px-3 py-2 text-right font-medium">平均 TPS</th><th className="px-3 py-2 text-right font-medium">缓存命中率</th><th className="px-4 py-2 text-right font-medium">成功率</th></tr></thead>
              <tbody>{providerModels.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">暂无模型数据</td></tr> : providerModels.map(model => (
                <tr key={model.providerModelId} className="border-t border-border/50">
                  <td className="max-w-52 truncate px-4 py-2.5 font-medium">{model.providerModelName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{model.requests.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{model.success > 0 ? formatLatency(model.avgLatencyMs) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{model.avgTtftMs == null ? '—' : formatLatency(model.avgTtftMs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{model.avgTps == null ? '—' : model.avgTps.toFixed(1)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{model.cacheHitRate == null ? '—' : `${(model.cacheHitRate * 100).toFixed(1)}%`}</td>
                  <td className="px-4 py-2.5 text-right"><Badge variant={model.successRate >= 0.95 ? 'success' : model.successRate >= 0.8 ? 'warning' : 'destructive'} className="h-5 px-1.5 text-[11px] font-normal">{(model.successRate * 100).toFixed(1)}%</Badge></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <TrendChart trend={props.detail.tokenTrend} range={props.range} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LatencyDistribution buckets={props.detail.latencyDistribution} />
        <FailureReasons reasons={props.detail.failureReasons} failedCount={props.detail.failureReasons.reduce((total, reason) => total + reason.count, 0)} />
      </div>
    </div>
  )
}
