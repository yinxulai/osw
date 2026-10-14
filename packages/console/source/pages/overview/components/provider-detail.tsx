import { BarChart3, CheckCircle2, Coins, DatabaseZap, TriangleAlert } from 'lucide-react'
import type { ProviderAnalyticsDetail } from '@common/schemas'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { MetricGrid } from '@/components/metric-grid'
import { SortableHeader } from '@/components/table-primitives'
import { Badge } from '@/components/ui/badge'
import { DeletedTag } from '@/components/deleted-tag'
import { useDeletedProviderModelIds } from '@/data/provider-models'
import { formatAverageOutput, formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { useLocale, useTranslation } from '@/i18n/provider'
import { useTableSort } from '@/hooks/use-table-sort'
import { formatCount, formatPercent, formatTokens } from '../lib/format'
import { MODEL_SORT_ACCESSOR, MODEL_SORT_DEFAULT, MODEL_SORT_DIRECTIONS } from '../lib/model-sort'
import { FailureReasons } from './failure-reasons'
import { LatencyDistribution } from './latency-distribution'
import { TrendChart } from './trend-chart'

interface ProviderDetailProps {
  detail: ProviderAnalyticsDetail
}

/*
 * 明细表头与排行榜共用一套排序定义，但内边距与对齐照这张表自己的排版。
 * 内边距分两层：`HEAD_*` 只管对齐与字体（`<th>` 上），`SORT_BUTTON_*` 才是真正画出缩进的地方——
 * 可排序的表头里按钮在流内铺满整格，内边距放在 `<th>` 上会与按钮的叠成两倍。
 * 按钮默认的 `px-3` 正好对上表体中间几列的 `px-3`，首末列才需要额外补一份。
 */
const HEAD_LEAD_CLASS = 'text-left system-2xs-medium'
const HEAD_CLASS = 'text-right system-2xs-medium'
const SORT_BUTTON_EDGE_CLASS = 'px-4'

export function ProviderDetail(props: ProviderDetailProps) {
  const { summary, models: providerModels } = props.detail
  const { cacheHitRate } = summary
  const t = useTranslation()
  const locale = useLocale()
  // 明细表没有行数上限，排的是接口返回的全部行；截断只发生在总览页的排行榜上。
  const { sortedRows, sort, toggleSort } = useTableSort(providerModels, MODEL_SORT_DEFAULT, MODEL_SORT_ACCESSOR, MODEL_SORT_DIRECTIONS)
  // 统计里的模型名是写入当时的快照，删掉配置行不会让它们从榜上消失——只补一枚「已删除」标签。
  const deletedProviderModelIds = useDeletedProviderModelIds()

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
              <thead className="bg-inset text-text-tertiary">
                <tr>
                  <SortableHeader label={t('overview.models.column.model')} active={sort.key === 'providerModelName'} direction={sort.direction} onSort={() => toggleSort('providerModelName')} className={HEAD_LEAD_CLASS} contentClassName={SORT_BUTTON_EDGE_CLASS} />
                  <SortableHeader label={t('overview.providerDetail.attempts')} active={sort.key === 'attempts'} direction={sort.direction} onSort={() => toggleSort('attempts')} className={HEAD_CLASS} align="end" />
                  <SortableHeader label={t('overview.models.column.avgTtft')} active={sort.key === 'avgTtftMs'} direction={sort.direction} onSort={() => toggleSort('avgTtftMs')} className={HEAD_CLASS} align="end" />
                  <SortableHeader label={t('overview.models.column.avgTps')} active={sort.key === 'avgTps'} direction={sort.direction} onSort={() => toggleSort('avgTps')} className={HEAD_CLASS} align="end" />
                  <SortableHeader label={t('overview.models.column.avgOutput')} active={sort.key === 'avgOutputTokens'} direction={sort.direction} onSort={() => toggleSort('avgOutputTokens')} className={HEAD_CLASS} align="end" />
                  <SortableHeader label={t('overview.models.column.cacheHitRate')} active={sort.key === 'cacheHitRate'} direction={sort.direction} onSort={() => toggleSort('cacheHitRate')} className={HEAD_CLASS} align="end" />
                  <SortableHeader label={t('overview.models.column.successRate')} active={sort.key === 'successRate'} direction={sort.direction} onSort={() => toggleSort('successRate')} className={HEAD_CLASS} contentClassName={SORT_BUTTON_EDGE_CLASS} align="end" />
                </tr>
              </thead>
              <tbody>{sortedRows.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-text-tertiary">{t('overview.providerDetail.models.empty')}</td></tr> : sortedRows.map(model => (
                <tr key={model.providerModelId} className="border-t border-border/40 transition-colors hover:bg-state-base-hover">
                  <td className="max-w-52 px-4 py-2.5 system-xs-medium text-text-primary">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate">{model.providerModelName}</span>
                      {deletedProviderModelIds.has(model.providerModelId) && <DeletedTag />}
                    </span>
                  </td>
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
