import { useState } from 'react'
import { ReceiptText, RefreshCw } from 'lucide-react'
import type { AnalyticsRange } from '@common/schemas'
import { getRouteApi, useNavigate, useParams } from '@tanstack/react-router'
import { AsyncState } from '@/components/async-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { routePaths } from '@/routing/routes'
import { useOverviewService, useProviderAnalyticsDetail } from './service'
import { OverviewBillDialog } from './components/overview-bill-dialog'
import { OverviewDashboard } from './components/overview-dashboard'
import { OverviewProviderSkeleton, OverviewSkeleton } from './components/overview-skeleton'
import { ProviderDetail } from './components/provider-detail'
import type { UsageDistributionMode } from './components/usage-distribution'
import { useBillReceipt } from './hooks/use-bill-receipt'
import { useOverviewBillContent } from './hooks/use-overview-bill-content'

/**
 * 索引页与供应商下钻页共用同一个组件，两者的 search schema 定义在 `/overview` 父路由上。
 * 用 `getRouteApi` 按路径取 hook，而不是 import 路由对象，避免与 `routing.tsx` 形成循环依赖。
 */
const overviewRouteApi = getRouteApi(routePaths.overview)

export function OverviewPage() {
  const { range } = overviewRouteApi.useSearch()
  // `/overview` 索引页没有该参数，`strict: false` 拿到整个路由树的参数并集。
  const { providerId } = useParams({ strict: false })
  // `from` 固定到父路由：切 range 时保持当前层级（列表页或某个供应商下钻页）。
  const navigate = useNavigate({ from: routePaths.overview })
  const { data, loading, refreshing, error, refresh } = useOverviewService(range)
  const providerDetail = useProviderAnalyticsDetail(providerId ?? null, range)
  const t = useTranslation()
  // 「用量分布」的画法记在页面这一层，而不是那张卡片里：切 range 时数据未到会先走骨架，
  // 卡片本身会被卸载，状态留在里面会被打回默认值（用户切到柱状图再换范围就丢了）。
  const [distributionMode, setDistributionMode] = useState<UsageDistributionMode>('heatmap')
  const [billOpen, setBillOpen] = useState(false)
  const receipt = useBillReceipt({ open: billOpen, range })
  const selectedProviderName = providerDetail.data?.summary.providerName
    ?? data?.providerStats.find(provider => provider.providerId === providerId)?.providerName

  const { statusLabel: billStatusLabel, contentProps: billContentProps } = useOverviewBillContent({
    providerId,
    range,
    data,
    providerDetail: providerDetail.data,
    selectedProviderName,
    receipt,
  })

  const renderProviderBody = () => (
    <AsyncState
      loading={providerDetail.loading || (!providerDetail.data && !providerDetail.error)}
      error={providerDetail.error ? `${t('overview.providerError.description')}\n${providerDetail.error}` : null}
      errorTitle={t('overview.providerError.title')}
      onRetry={() => void providerDetail.refresh()}
      loadingFallback={<OverviewProviderSkeleton />}
    >
      {providerDetail.data ? <ProviderDetail detail={providerDetail.data} /> : null}
    </AsyncState>
  )

  const renderDashboardBody = () => (
    <AsyncState
      loading={loading}
      error={error ? `${t('overview.error.description')}\n${error}` : null}
      errorTitle={t('overview.error.title')}
      onRetry={() => void refresh()}
      loadingFallback={<OverviewSkeleton mode={distributionMode} />}
    >
      {data ? (
        <OverviewDashboard
          data={data}
          distributionMode={distributionMode}
          onDistributionModeChange={setDistributionMode}
          onSelectProvider={provider => void navigate({
            to: routePaths.overviewProvider,
            params: { providerId: provider.providerId },
            search: { range },
          })}
        />
      ) : null}
    </AsyncState>
  )

  const activeRefreshing = providerId ? providerDetail.refreshing : refreshing
  const refreshActiveView = () => providerId ? providerDetail.refresh() : refresh()

  return (
    <PageLayout>
      <PageHeader
        title={providerId ? t('overview.provider.title', { provider: selectedProviderName ?? t('overview.provider.unknown') }) : t('overview.title')}
        description={providerId ? t('overview.provider.description') : t('overview.description')}
        breadcrumb={providerId ? selectedProviderName ?? t('overview.provider.unknown') : undefined}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setBillOpen(true)}>
              <ReceiptText size={13} />
              {t('overview.bill.action')}
            </Button>
            <Tabs value={range} onValueChange={value => void navigate({ search: { range: value as AnalyticsRange } })}>
              <TabsList>
                <TabsTrigger value="today" className="px-2.5 text-xs">{t('overview.range.today')}</TabsTrigger>
                <TabsTrigger value="7d" className="px-2.5 text-xs">{t('overview.range.7d')}</TabsTrigger>
                <TabsTrigger value="30d" className="px-2.5 text-xs">{t('overview.range.30d')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="icon" title={t('overview.refresh')} aria-label={t('overview.refresh')} disabled={activeRefreshing} onClick={() => void refreshActiveView()}>
              <RefreshCw size={14} className={cn(activeRefreshing && 'animate-spin')} />
            </Button>
          </div>
        )}
      />
      <PageContent>
        {providerId ? renderProviderBody() : renderDashboardBody()}
        <OverviewBillDialog
          open={billOpen}
          onClose={() => setBillOpen(false)}
          receipt={receipt}
          statusLabel={billStatusLabel}
          contentProps={billContentProps}
        />
      </PageContent>
    </PageLayout>
  )
}
