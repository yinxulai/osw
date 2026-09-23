import type { ModelStat } from '@common/schemas'
import { tableCellClass, tableHeaderCellClass, tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatAverageOutput, formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatCount } from '../lib/format'

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
  const rows = stats.slice(0, MODEL_RANKING_LIMIT)

  return (
    <Card className="w-full">
      <CardSectionHeader title={t('overview.models.title')} description={t('overview.models.description')} compact />
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={tableHeaderClass}>
              <tr>
                <th className={cn(tableHeaderCellClass, 'w-8 px-4')}>{t('overview.models.column.rank')}</th>
                <th className={tableHeaderCellClass}>{t('overview.models.column.model')}</th>
                <th className={tableHeaderCellClass}>{t('overview.models.column.provider')}</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>{t('overview.models.column.requests')}</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>{t('overview.models.column.avgTtft')}</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>{t('overview.models.column.avgTps')}</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>{t('overview.models.column.avgOutput')}</th>
                <th className={cn(tableHeaderCellClass, 'text-right')}>{t('overview.models.column.cacheHitRate')}</th>
                <th className={cn(tableHeaderCellClass, 'px-4 text-right')}>{t('overview.models.column.successRate')}</th>
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
                  <td className={cn(tableCellClass, 'system-xs-medium text-text-primary')}>{m.providerModelName}</td>
                  <td className={cn(tableCellClass, 'text-text-tertiary')}>{m.providerName}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatCount(locale, m.attempts)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatMilliseconds(m.avgTtftMs)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatOutputSpeed(m.avgTps)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatAverageOutput(m.avgOutputTokens)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{m.cacheHitRate == null ? '—' : `${(m.cacheHitRate * 100).toFixed(1)}%`}</td>
                  <td className={cn(tableCellClass, 'px-4 text-right')}>
                    <Badge variant={m.successRate >= 0.95 ? 'success' : m.successRate >= 0.8 ? 'warning' : 'destructive'} className="h-5 px-1.5 font-mono">
                      {(m.successRate * 100).toFixed(1)}%
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
