import type { ModelStat } from '@common/schemas'
import { SortableHeader, tableCellClass, tableHeaderCellClass, tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { DeletedTag } from '@/components/deleted-tag'
import { useDeletedProviderIds } from '@/data/providers'
import { useDeletedProviderModelIds } from '@/data/provider-models'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatAverageOutput, formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { useLocale, useTranslation } from '@/i18n/provider'
import { useTableSort } from '@/hooks/use-table-sort'
import { formatCount, formatPercent } from '../lib/format'
import { MODEL_SORT_ACCESSOR, MODEL_SORT_DEFAULT, MODEL_SORT_DIRECTIONS } from '../lib/model-sort'

interface ModelRankingProps {
  stats: ModelStat[]
}

/**
 * 排行榜只列前几名。
 *
 * 接口会多回一些模型行（账单要合并跨供应商的同名模型，得先拿到足够多的候选），
 * 截断因此是榜单自己的事：它是「前 N 名」，不是「接口返回了多少行」。
 */
const MODEL_RANKING_LIMIT = 10

export function ModelRanking(props: ModelRankingProps) {
  const { stats } = props
  const t = useTranslation()
  const locale = useLocale()
  // 先排序再截断：按「平均 TTFT」点一下要能翻出**所有**候选里最慢的那几个，
  // 只在榜单的十行里倒腾等于把最慢的模型挡在门外——它通常正好因为慢而排不进前 10。
  const { sortedRows, sort, toggleSort } = useTableSort(stats, MODEL_SORT_DEFAULT, MODEL_SORT_ACCESSOR, MODEL_SORT_DIRECTIONS)
  const rows = sortedRows.slice(0, MODEL_RANKING_LIMIT)
  // 统计里的供应商名/模型名是写入当时的快照，删掉配置行不会让它们从榜上消失——只补「已删除」标签。
  const deletedProviderIds = useDeletedProviderIds()
  const deletedProviderModelIds = useDeletedProviderModelIds()

  return (
    <Card className="w-full">
      <CardSectionHeader title={t('overview.models.title')} description={t('overview.models.description')} compact />
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={tableHeaderClass}>
              <tr>
                <th className={cn(tableHeaderCellClass, 'w-8 px-4')}>{t('overview.models.column.rank')}</th>
                <SortableHeader label={t('overview.models.column.model')} active={sort.key === 'providerModelName'} direction={sort.direction} onSort={() => toggleSort('providerModelName')} />
                <SortableHeader label={t('overview.models.column.provider')} active={sort.key === 'providerName'} direction={sort.direction} onSort={() => toggleSort('providerName')} />
                <SortableHeader label={t('overview.models.column.requests')} active={sort.key === 'attempts'} direction={sort.direction} onSort={() => toggleSort('attempts')} className="text-right" align="end" />
                <SortableHeader label={t('overview.models.column.avgTtft')} active={sort.key === 'avgTtftMs'} direction={sort.direction} onSort={() => toggleSort('avgTtftMs')} className="text-right" align="end" />
                <SortableHeader label={t('overview.models.column.avgTps')} active={sort.key === 'avgTps'} direction={sort.direction} onSort={() => toggleSort('avgTps')} className="text-right" align="end" />
                <SortableHeader label={t('overview.models.column.avgOutput')} active={sort.key === 'avgOutputTokens'} direction={sort.direction} onSort={() => toggleSort('avgOutputTokens')} className="text-right" align="end" />
                <SortableHeader label={t('overview.models.column.cacheHitRate')} active={sort.key === 'cacheHitRate'} direction={sort.direction} onSort={() => toggleSort('cacheHitRate')} className="text-right" align="end" />
                <SortableHeader label={t('overview.models.column.successRate')} active={sort.key === 'successRate'} direction={sort.direction} onSort={() => toggleSort('successRate')} className="text-right" contentClassName="px-4" align="end" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center system-xs-regular text-text-tertiary">
                    {t('overview.models.empty')}
                  </td>
                </tr>
              ) : rows.map((m, idx) => (
                <tr key={m.providerModelId} className={tableRowClass}>
                  <td className={cn(tableCellClass, 'px-4')}>
                    <span className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-full font-mono system-2xs-medium',
                      idx < 3 ? 'bg-primary text-primary-foreground' : 'bg-inset text-text-tertiary'
                    )}>
                      {idx + 1}
                    </span>
                  </td>
                  <td className={cn(tableCellClass, 'system-xs-medium text-text-primary')}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate">{m.providerModelName}</span>
                      {deletedProviderModelIds.has(m.providerModelId) && <DeletedTag />}
                    </span>
                  </td>
                  <td className={cn(tableCellClass, 'text-text-tertiary')}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate">{m.providerName}</span>
                      {deletedProviderIds.has(m.providerId) && <DeletedTag />}
                    </span>
                  </td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatCount(locale, m.attempts)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatMilliseconds(m.avgTtftMs)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatOutputSpeed(m.avgTps)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatAverageOutput(m.avgOutputTokens)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{m.cacheHitRate == null ? '—' : formatPercent(m.cacheHitRate)}</td>
                  <td className={cn(tableCellClass, 'px-4 text-right')}>
                    <Badge variant={m.successRate >= 0.95 ? 'success' : m.successRate >= 0.8 ? 'warning' : 'destructive'} className="h-5 px-1.5 font-mono">
                      {formatPercent(m.successRate)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
