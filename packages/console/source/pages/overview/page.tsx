import { useMemo, useState } from 'react'
import { AlertTriangle, ReceiptText, RefreshCw } from 'lucide-react'
import type { AnalyticsRange } from '@common/schemas'
import { getRouteApi, useNavigate, useParams } from '@tanstack/react-router'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { routePaths } from '@/routing/routes'
import { useOverviewService, useProviderAnalyticsDetail } from './service'
import { StatsGrid } from './components/stats-grid'
import { UsageDistribution, type UsageDistributionMode } from './components/usage-distribution'
import { ProviderDistribution } from './components/provider-distribution'
import { ProviderDetail } from './components/provider-detail'
import { ModelRanking } from './components/model-ranking'
import { LatencyDistribution } from './components/latency-distribution'
import { FailureReasons } from './components/failure-reasons'
import { BillContent } from './components/bill-content'
import { BillExportScene } from './components/bill-export-scene'
import { ReceiptControls, ReceiptPullHint } from './components/receipt-controls'
import { ReceiptPrinterPreview, receiptMeters } from './components/receipt-printer-preview'
import { buildBillRows } from './lib/bill-models'
import { formatBillRangeLabel } from './lib/format'
import { useBillReceipt } from './hooks/use-bill-receipt'

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
  const locale = useLocale()
  const t = useTranslation()
  // 「用量分布」的画法记在页面这一层，而不是那张卡片里：切 range 时数据未到会先走骨架，
  // 卡片本身会被卸载，状态留在里面会被打回默认值（用户切到柱状图再换范围就丢了）。
  const [distributionMode, setDistributionMode] = useState<UsageDistributionMode>('heatmap')
  const [billOpen, setBillOpen] = useState(false)
  const receipt = useBillReceipt({ open: billOpen, range })
  const selectedProviderName = providerDetail.data?.summary.providerName
    ?? data?.providerStats.find(provider => provider.providerId === providerId)?.providerName

  const billModels = useMemo(() => {
    if (providerId) return providerDetail.data?.models ?? []
    return data?.modelStats ?? []
  }, [providerId, providerDetail.data?.models, data?.modelStats])

  const billAttempts = useMemo(
    () => billModels.reduce((total, item) => total + item.attempts, 0),
    [billModels],
  )

  // 明细行按模型名合并（理由见 `buildBillRows`）：账单没有「供应商」这一列，
  // 同一个模型被几家供应商都接进来时，拆成几行会被读成好几笔消费。
  const billRows = useMemo(
    () => buildBillRows(billModels, 12),
    [billModels],
  )

  const billSummary = providerId ? providerDetail.data?.summary : data?.summary
  const billStatusLabel = receipt.stage === 'complete'
    ? t('overview.bill.status.complete')
    : receipt.stage === 'printing'
      ? t('overview.bill.status.printing')
      : t('overview.bill.status.processing')
  const billFailedCount = providerId
    ? (providerDetail.data?.summary.failed ?? 0)
    : (data?.summary.failedCount ?? 0)
  const billSuccessRate = billSummary?.successRate ?? 0
  const billCacheHitRate = billSummary?.cacheHitRate
  const billRequestCount = providerId
    ? (providerDetail.data?.summary.attempts ?? 0)
    : (data?.summary.totalRequests ?? 0)
  const billProjectName = providerId ? (selectedProviderName ?? t('overview.bill.scope.provider')) : t('overview.bill.scope.global')
  const billCashierName = 'OSW-AUTO'
  const billDataRangeLabel = formatBillRangeLabel(locale, range, receipt.printedAt)

  // 对话框里的预览与离屏的导出场景共用同一份账单内容（见 `BillContent` 注释）。
  const billContentProps = {
    projectName: billProjectName,
    cashierName: billCashierName,
    dataRangeLabel: billDataRangeLabel,
    rows: billRows,
    successRate: billSuccessRate,
    cacheHitRate: billCacheHitRate ?? null,
    requestCount: billRequestCount,
    attempts: billAttempts,
    failedCount: billFailedCount,
    totalTokens: billSummary?.totalTokens ?? 0,
    qrDataUrl: receipt.qrDataUrl,
  }

  const renderLoading = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-inset p-3">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="h-44 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </Card>
        {/* 用量分布：骨架照着真图的形状铺（热力图 175 格 = 25 列 × 7 行，接近 30 天的 181 格；
            柱状图是 h-44 的一整块）。外面套的 `h-44` 与真图一致（见 `HEAT_AREA_HEIGHT`），
            两张卡片不会在数据到位时跳一下高度。 */}
        <Card className="p-4">
          <Skeleton className="mb-2 h-4 w-24" />
          <Skeleton className="mb-3 h-3 w-40" />
          <div className="flex h-44 flex-col justify-center">
            {distributionMode === 'heatmap' ? (
              <div className="mx-auto grid w-full gap-0.75" style={{ gridTemplateColumns: 'repeat(25, minmax(0, 1fr))' }}>
                {Array.from({ length: 175 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square w-full rounded-[2px]" />
                ))}
              </div>
            ) : (
              <Skeleton className="h-44 w-full" />
            )}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </Card>
      </div>
    </div>
  )

  const renderProviderDetail = () => {
    if (providerDetail.loading) {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div>
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-60 w-full" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      )
    }
    if (providerDetail.error) {
      return (
        <Card>
          <EmptyState
            embedded
            icon={AlertTriangle}
            title={t('overview.providerError.title')}
            description={t('overview.providerError.description')}
            action={<Button variant="outline" size="sm" onClick={() => void providerDetail.refresh()}>{t('common.action.refresh')}</Button>}
          />
        </Card>
      )
    }
    if (!providerDetail.data) return null
    return <ProviderDetail detail={providerDetail.data} />
  }

  const renderContent = () => {
    if (providerId) return renderProviderDetail()
    if (error) {
      return (
        <Card>
          <EmptyState
            embedded
            icon={AlertTriangle}
            title={t('overview.error.title')}
            description={t('overview.error.description')}
            action={<Button variant="outline" size="sm" onClick={() => void refresh()}>{t('common.action.refresh')}</Button>}
          />
        </Card>
      )
    }
    if (!data) return null
    return (
      <>
        <div data-screenshot="overview-stats">
          <StatsGrid summary={data.summary} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
          {/* 点击供应商 = 跳到 `/overview/$providerId`，range 原样带过去。 */}
          <ProviderDistribution
            stats={data.providerStats}
            onSelectProvider={provider => void navigate({
              to: routePaths.overviewProvider,
              params: { providerId: provider.providerId },
              search: { range },
            })}
          />
          <UsageDistribution
            mode={distributionMode}
            onModeChange={setDistributionMode}
            heat={data.heat}
            heatIntervalMs={data.heatIntervalMs}
            trend={data.trend}
            trendIntervalMs={data.trendIntervalMs}
          />
        </div>
        <ModelRanking stats={data.modelStats} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LatencyDistribution buckets={data.latencyDistribution} />
          <FailureReasons reasons={data.failureReasons} failedCount={data.summary.failedCount} totalRequests={data.summary.totalRequests} />
        </div>
      </>
    )
  }

  const renderBody = () => {
    if (!providerId && loading) return renderLoading()
    return renderContent()
  }

  const activeRefreshing = providerId ? providerDetail.refreshing : refreshing
  const refreshActiveView = () => providerId ? providerDetail.refresh() : refresh()
  return (
    <PageLayout>
      <PageHeader
        title={providerId ? t('overview.provider.title', { provider: selectedProviderName ?? t('overview.provider.unknown') }) : t('overview.title')}
        description={providerId ? t('overview.provider.description') : t('overview.description')}
        breadcrumb={providerId ? selectedProviderName ?? t('overview.provider.unknown') : undefined}
        actions={(
          <div className="flex items-center gap-2">
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
        {renderBody()}

        <Dialog open={billOpen} onOpenChange={setBillOpen}>
          <DialogContent
            showCloseButton={false}
            overlayClassName="bg-black/28 supports-backdrop-filter:backdrop-blur-md"
            className="top-0! left-0! h-screen! w-screen! max-w-none! translate-x-0! translate-y-0! overflow-hidden! rounded-none! border-0! bg-transparent! p-0! shadow-none!"
          >
            {/* 对话框被铺成整屏、看上去没有标题，但标题必须在：Radix 靠它给弹窗命名，
                否则读屏软件只会念成「对话框」。 */}
            <DialogTitle className="sr-only">{t('overview.bill.title')}</DialogTitle>
            <div className="relative flex h-full w-full items-start justify-center overflow-hidden px-4 pt-4 sm:px-8 sm:pt-6">
              <ReceiptControls
                stage={receipt.stage}
                downloading={receipt.downloading}
                onPrint={receipt.print}
                onDownload={() => void receipt.download()}
                onClose={() => setBillOpen(false)}
              />
              <ReceiptPullHint stage={receipt.stage} touched={receipt.touched} meters={receiptMeters(receipt.offsetY)} />

              <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-1 sm:p-2">
                <div className="relative z-10 flex h-full w-full max-w-140 items-center justify-center overflow-hidden">
                  <ReceiptPrinterPreview
                    stage={receipt.stage}
                    statusLabel={billStatusLabel}
                    receiptOffsetY={receipt.offsetY}
                    {...receipt.pointerHandlers}
                    dragging={receipt.dragging}
                  >
                    <BillContent {...billContentProps} />
                  </ReceiptPrinterPreview>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/*
          导出专用的离屏场景：`fixed` 挪到视口外，导出时只按内容高度光栅化，
          既不参与页面布局也不影响对话框里那台打印机的动效。
          `html-to-image` 是把节点序列化进 SVG，位置在视口外完全不影响渲染。
        */}
        {billOpen ? (
          <div aria-hidden="true" className="pointer-events-none fixed top-0 left-[-20000px]">
            <div ref={receipt.exportRef}>
              <BillExportScene statusLabel={billStatusLabel}>
                <BillContent {...billContentProps} />
              </BillExportScene>
            </div>
          </div>
        ) : null}
      </PageContent>
    </PageLayout>
  )
}
