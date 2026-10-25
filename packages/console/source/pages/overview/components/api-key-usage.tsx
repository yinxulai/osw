import type { ApiKey, ApiKeyStat } from '@common/schemas'
import { SortableHeader, tableCellClass, tableHeaderClass, tableRowClass } from '@/components/table-primitives'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatMilliseconds } from '@common/metrics'
import { useLocale, useTranslation } from '@/i18n/provider'
import { useTableSort } from '@/hooks/use-table-sort'
import { cn } from '@/lib/utils'
import { formatCount, formatPercent } from '../lib/format'
import { buildApiKeyUsageRows } from '../lib/api-key-usage-rows'
import { API_KEY_USAGE_SORT_ACCESSOR, API_KEY_USAGE_SORT_DEFAULT, API_KEY_USAGE_SORT_DIRECTIONS } from '../lib/api-key-usage-sort'

interface ApiKeyUsageProps {
  stats: ApiKeyStat[]
  keys: ApiKey[]
}

/**
 * 按 Key 的用量表。
 *
 * 放在总览而不是 Key 管理页：它回答的是「额度花在谁身上」，与「这把 Key 还能不能用」
 * 是两个问题。Key 管理页只负责签发 / 停用 / 轮换，用量归统计分析。
 *
 * 排版与「模型使用排行」严格同构（`model-ranking.tsx`）：同屏两张表用同一套表头、同一套
 * 内边距、同一套右对齐的数字列。以前这里是 shadcn `Table` 套一层带边框的卡片头，
 * 与旁边的排行挨着看就像两个页面出来的。
 *
 * `apiKeyId === null` 的行是**未署名**：一把 Key 都还没建时的请求都落在这里，界面如实显示。
 */
export function ApiKeyUsage(props: ApiKeyUsageProps) {
  const { stats, keys } = props
  const t = useTranslation()
  const locale = useLocale()
  const rows = buildApiKeyUsageRows(stats, keys, t)
  const { sortedRows, sort, toggleSort } = useTableSort(rows, API_KEY_USAGE_SORT_DEFAULT, API_KEY_USAGE_SORT_ACCESSOR, API_KEY_USAGE_SORT_DIRECTIONS)

  return (
    <Card className="w-full">
      <CardSectionHeader title={t('overview.apiKeys.title')} description={t('overview.apiKeys.description')} compact />
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={tableHeaderClass}>
              <tr>
                <SortableHeader label={t('overview.apiKeys.column.key')} active={sort.key === 'name'} direction={sort.direction} onSort={() => toggleSort('name')} contentClassName="px-4" />
                <SortableHeader label={t('overview.apiKeys.column.requests')} active={sort.key === 'requests'} direction={sort.direction} onSort={() => toggleSort('requests')} className="text-right" align="end" />
                <SortableHeader label={t('overview.apiKeys.column.tokens')} active={sort.key === 'totalTokens'} direction={sort.direction} onSort={() => toggleSort('totalTokens')} className="text-right" align="end" />
                <SortableHeader label={t('overview.apiKeys.column.successRate')} active={sort.key === 'successRate'} direction={sort.direction} onSort={() => toggleSort('successRate')} className="text-right" align="end" />
                <SortableHeader label={t('overview.apiKeys.column.avgLatency')} active={sort.key === 'avgLatencyMs'} direction={sort.direction} onSort={() => toggleSort('avgLatencyMs')} className="text-right" contentClassName="px-4" align="end" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center system-xs-regular text-text-tertiary">
                    {t('overview.apiKeys.empty')}
                  </td>
                </tr>
              ) : sortedRows.map(row => (
                <tr key={row.apiKeyId ?? 'anonymous'} className={tableRowClass}>
                  <td className={cn(tableCellClass, 'px-4 system-xs-medium text-text-primary')}>
                    <span className="block min-w-0 truncate">{row.name}</span>
                  </td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatCount(locale, row.requests)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{formatCount(locale, row.totalTokens)}</td>
                  <td className={cn(tableCellClass, 'text-right tabular-nums')}>{row.successRate == null ? '—' : formatPercent(row.successRate)}</td>
                  <td className={cn(tableCellClass, 'px-4 text-right tabular-nums')}>{row.avgLatencyMs == null ? '—' : formatMilliseconds(row.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
