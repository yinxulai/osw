import { ChevronRight } from 'lucide-react'
import type { ProviderStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { DeletedTag } from '@/components/deleted-tag'
import { useDeletedProviderIds } from '@/data/providers'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatCount, getProviderColor } from '../lib/format'

interface ProviderDistributionProps {
  stats: ProviderStat[]
  onSelectProvider?: (provider: ProviderStat) => void
}

export function ProviderDistribution(props: ProviderDistributionProps) {
  const { stats } = props
  const t = useTranslation()
  const locale = useLocale()
  // 榜单里的供应商名是写入当时的快照，删掉配置行不会让它从榜上消失——只补「已删除」标签。
  const deletedProviderIds = useDeletedProviderIds()

  return (
    <Card className="min-w-70">
      <CardSectionHeader title={t('overview.providers.title')} description={t('overview.providers.description')} compact />
      {/* 不加 `pt-1`：列表区与图表区都是 `h-44`，两张卡并排时高度才能一分不差。 */}
      <CardContent>
        {/*
          列表区固定 `h-44`（与右边「用量分布」的图表区同一个数）：供应商有几家、条数多少
          都不该改变卡片高度，多了就滚动。`content-start` 是必要的——网格容器比内容高时
          默认会把 auto 行拉满，两三条供应商之间会被撑出大段空隙。
        */}
        {stats.length === 0 ? (
          <div className="flex h-44 items-center justify-center system-xs-regular text-text-tertiary">
            {t('overview.providers.empty')}
          </div>
        ) : (
          <div className="grid h-44 content-start gap-2.5 overflow-y-auto pr-1">
            {stats.map((p, idx) => (
              <button
                key={p.providerId}
                type="button"
                className="group w-full text-left"
                onClick={() => props.onSelectProvider?.(p)}
                disabled={!props.onSelectProvider}
                aria-label={props.onSelectProvider ? t('logicalModels.row.viewAnalytics', { provider: p.providerName }) : undefined}
              >
                <div className="mb-1 flex items-center justify-between gap-2 system-xs-regular">
                  <span className="flex min-w-0 items-center gap-2 system-xs-medium text-text-primary">
                    <span className={cn('size-2 shrink-0 rounded-full', getProviderColor(idx))} />
                    <span className="truncate">{p.providerName}</span>
                    {deletedProviderIds.has(p.providerId) && <DeletedTag />}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-text-tertiary tabular-nums">
                    {p.percent}% · {formatCount(locale, p.attempts)}
                    {props.onSelectProvider && <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-inset">
                  <div className={cn('h-full rounded-full', getProviderColor(idx))} style={{ width: `${p.percent}%` }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
