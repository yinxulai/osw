import { BarChart3, CheckCircle2, Coins, DatabaseZap, TriangleAlert } from 'lucide-react'
import type { ProviderAnalyticsDetail } from '@common/schemas'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { MetricGrid } from '@/components/metric-grid'
import { Badge } from '@/components/ui/badge'
import { formatAverageOutput, formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatCount, formatPercent, formatTokens } from '../lib/format'
import { FailureReasons } from './failure-reasons'
import { LatencyDistribution } from './latency-distribution'
import { TrendChart } from './trend-chart'

interface ProviderDetailProps {
  detail: ProviderAnalyticsDetail
}

export function ProviderDetail(props: ProviderDetailProps) {
  const { summary, models: providerModels } = props.detail
  const { cacheHitRate } = summary
  const t = useTranslation()
  const locale = useLocale()

  return (
    <div className="grid gap-4">
      {/* 命中率与总览页顶部同一张卡同一口径，只是样本换成这个提供方自己的成功尝试；
          没有输入时写 `—`。这里不放平均延迟：同一页的模型表已经用 TTFT 与 TPS 说了「快不快」。 */}
      <MetricGrid className="sm:grid-cols-5" items={[
        { label: t('overview.providerDetail.attempts'), value: formatCount(locale, summary.attempts), Icon: BarChart3 },
        { label: t('overview.providerDetail.successRate'), value: formatPercent(summary.successRate), Icon: CheckCircle2 },
        { label: t('overview.providerDetail.failed'), value: formatCount(locale, summary.failed), Icon: TriangleAlert },
        { label: t('overview.providerDetail.cacheHitRate'), value: cacheHitRate == null ? '—' : formatPercent(cacheHitRate), Icon: DatabaseZap, info: t('overview.providerDetail.cacheHitRateHint') },
        { label: t('overview.providerDetail.usage'), value: formatTokens(summary.totalTokens), Icon: Coins },
      ]} />

      <Card>
        <CardSectionHeader title={t('overview.providerDetail.models.title')} description={t('overview.providerDetail.models.description')} compact />
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-180 system-xs-regular">
              {/* 列集合与总览页的「模型使用排行」保持一致：同一批指标在两处展示不该换名字、换顺序。
                  平均延迟不在这里出现——速度与首字已经覆盖了「快不快」，而「产出多少」由平均输出回答。 */}
              <thead className="bg-inset text-text-tertiary"><tr><th className="px-4 py-2 text-left system-2xs-medium">{t('overview.models.column.model')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.providerDetail.attempts')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.avgTtft')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.avgTps')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.avgOutput')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.cacheHitRate')}</th><th className="px-4 py-2 text-right system-2xs-medium">{t('overview.models.column.successRate')}</th></tr></thead>
              <tbody>{providerModels.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-text-tertiary">{t('overview.providerDetail.models.empty')}</td></tr> : providerModels.map(model => (
                <tr key={model.providerModelId} className="border-t border-border/40 transition-colors hover:bg-state-base-hover">
                  <td className="max-w-52 truncate px-4 py-2.5 system-xs-medium text-text-primary">{model.providerModelName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCount(locale, model.attempts)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatMilliseconds(model.avgTtftMs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatOutputSpeed(model.avgTps)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatAverageOutput(model.avgOutputTokens)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{model.cacheHitRate == null ? '—' : formatPercent(model.cacheHitRate)}</td>
                  <td className="px-4 py-2.5 text-right"><Badge variant={model.successRate >= 0.95 ? 'success' : model.successRate >= 0.8 ? 'warning' : 'destructive'} className="h-5 px-1.5 font-mono">{formatPercent(model.successRate)}</Badge></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <TrendChart trend={props.detail.tokenTrend} trendIntervalMs={props.detail.trendIntervalMs} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LatencyDistribution buckets={props.detail.latencyDistribution} />
        <FailureReasons reasons={props.detail.failureReasons} failedCount={props.detail.failureReasons.reduce((total, reason) => total + reason.count, 0)} />
      </div>
    </div>
  )
}
