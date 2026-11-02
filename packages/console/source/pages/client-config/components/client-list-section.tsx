import { RefreshCw, Wrench } from 'lucide-react'
import type { ClientConfigOverviewItem } from '@common/client-config'
import { AsyncState } from '@/components/async-state'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from '@/i18n/provider'
import { ClientListHeader, ClientRow } from './client-row'

interface ClientListSectionProps {
  items: ClientConfigOverviewItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

/** 列表骨架：一条表头 + 若干行，形状照着真身量。 */
function ClientListSkeleton() {
  return (
    <Card className="pb-0">
      <CardHeaderPlaceholder />
      <CardContent className="p-0">
        <div className="hidden border-b border-border/50 px-4 py-2.5 md:block">
          <Skeleton className="h-3 w-40 rounded-sm" />
        </div>
        <div className="divide-y divide-border/50">
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="px-4 py-2.5" key={index}>
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function CardHeaderPlaceholder() {
  const t = useTranslation()
  return (
    <SettingsCardHeader icon={<Wrench />} title={t('clientConfig.list.title')} description={t('clientConfig.list.description')} />
  )
}

/** 客户端列表：加载 / 错误 / 空 / 数据四态都在这里，页面只负责摆放。 */
export function ClientListSection(props: ClientListSectionProps) {
  const t = useTranslation()

  return (
    <AsyncState
      loading={props.loading}
      error={props.error}
      errorTitle={t('clientConfig.loadFailed')}
      onRetry={props.onRefresh}
      empty={props.items.length === 0}
      loadingFallback={<ClientListSkeleton />}
      emptyState={{
        icon: Wrench,
        title: t('clientConfig.noClients'),
        description: t('clientConfig.noClientsDescription'),
        action: (
          <Button variant="outline" onClick={props.onRefresh}>
            <RefreshCw size={14} />
            {t('common.action.refresh')}
          </Button>
        ),
      }}
    >
      <Card className="pb-0">
        <SettingsCardHeader icon={<Wrench />} title={t('clientConfig.list.title')} description={t('clientConfig.list.description')} />
        {/* 行要贴到卡片边缘，所以内容区自己去掉留白，卡片自身去掉底部留白。 */}
        <CardContent className="p-0">
          <ClientListHeader />
          <ul className="divide-y divide-border/50">
            {props.items.map(item => (
              <ClientRow item={item} key={item.clientKey} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </AsyncState>
  )
}
