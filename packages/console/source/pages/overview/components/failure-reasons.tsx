import type { FailureReasonStat } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatCount } from '../lib/format'

interface FailureReasonsProps {
  reasons: FailureReasonStat[]
  failedCount: number
  totalRequests?: number
}

const ERROR_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-pink-500',
  'bg-purple-500',
  'bg-indigo-500',
  'bg-sky-500',
]

export function FailureReasons(props: FailureReasonsProps) {
  const { reasons, failedCount, totalRequests } = props
  const t = useTranslation()
  const locale = useLocale()
  const failureCount = formatCount(locale, failedCount)
  const description = totalRequests == null
    ? t('overview.failure.description.count', { count: failureCount })
    : t('overview.failure.description.rate', {
      count: failureCount,
      rate: totalRequests > 0 ? ((failedCount / totalRequests) * 100).toFixed(2) : '0.00',
    })

  return (
    <Card className="min-w-0">
      <CardSectionHeader
        title={t('overview.failure.title')}
        description={description}
        compact
      />
      <CardContent className="pt-0">
        {reasons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-tertiary">
            <div className="text-2xl text-text-success">✓</div>
            <div className="mt-1 system-xs-regular">{t('overview.failure.empty')}</div>
          </div>
        ) : (
          <div className="grid gap-3">
            {/* 横向堆叠条 */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-inset">
              {reasons.map((r, idx) => (
                <div
                  key={r.reason}
                  className={cn(ERROR_COLORS[idx % ERROR_COLORS.length], 'transition-all')}
                  style={{ width: `${r.percent}%` }}
                  title={t('overview.failure.barTitle', {
                    reason: t(`failureReason.${r.reason}` as UiCatalogKey),
                    count: r.count,
                    percent: r.percent,
                  })}
                />
              ))}
            </div>
            {/* 错误列表 */}
            <div className="grid gap-2">
              {reasons.map((r, idx) => (
                <div key={r.reason} className="flex items-center gap-2.5 system-xs-regular">
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', ERROR_COLORS[idx % ERROR_COLORS.length])} />
                  <span className="min-w-0 flex-1 truncate text-text-secondary">
                    {t(`failureReason.${r.reason}` as UiCatalogKey)}
                  </span>
                  <span className="shrink-0 font-mono text-text-tertiary tabular-nums">
                    {formatCount(locale, r.count)}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-text-tertiary tabular-nums">
                    {r.percent}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
