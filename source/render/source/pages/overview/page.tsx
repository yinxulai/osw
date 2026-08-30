import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { AnalyticsRange, ProviderStat } from '@common/schemas'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAppUiStore } from '@/store/app-ui-store'
import { useOverviewService, useProviderAnalyticsDetail } from './service'
import { StatsGrid } from './components/stats-grid'
import { TrendChart } from './components/trend-chart'
import { ProviderDistribution } from './components/provider-distribution'
import { ProviderDetail } from './components/provider-detail'
import { ModelRanking } from './components/model-ranking'
import { LatencyDistribution } from './components/latency-distribution'
import { FailureReasons } from './components/failure-reasons'

export function OverviewPage() {
  const { timeRange, setTimeRange, data, loading, refreshing, error, refresh } = useOverviewService()
  const overviewProviderId = useAppUiStore(state => state.overviewProviderId)
  const setOverviewProviderId = useAppUiStore(state => state.setOverviewProviderId)
  const [selectedProvider, setSelectedProvider] = useState<ProviderStat | null>(null)
  const providerDetail = useProviderAnalyticsDetail(selectedProvider?.providerId ?? null, timeRange)

  useEffect(() => {
    if (!overviewProviderId || !data) return
    const provider = data.providerStats.find(item => item.providerId === overviewProviderId)
    if (provider) setSelectedProvider(provider)
    setOverviewProviderId(null)
  }, [data, overviewProviderId, setOverviewProviderId])

  const renderLoading = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-muted p-3">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-40 w-full" />
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
            title="供应商分析加载失败"
            description="暂时无法读取该时间范围的统计数据，请稍后重试。"
            action={<Button variant="outline" size="sm" onClick={() => void providerDetail.refresh()}>重新加载</Button>}
          />
        </Card>
      )
    }
    if (!providerDetail.data) return null
    return <ProviderDetail detail={providerDetail.data} range={timeRange} />
  }

  const renderContent = () => {
    if (selectedProvider) return renderProviderDetail()
    if (error) {
      return (
        <Card>
          <EmptyState
            embedded
            icon={AlertTriangle}
            title="统计数据加载失败"
            description="暂时无法读取统计数据，请检查服务状态后重试。"
            action={<Button variant="outline" size="sm" onClick={() => void refresh()}>重新加载</Button>}
          />
        </Card>
      )
    }
    if (!data) return null
    return (
      <>
        <StatsGrid summary={data.summary} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
          <ProviderDistribution stats={data.providerStats} onSelectProvider={setSelectedProvider} />
          <TrendChart trend={data.trend} range={timeRange} />
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
    if (!selectedProvider && loading) return renderLoading()
    return renderContent()
  }

  const activeRefreshing = selectedProvider ? providerDetail.refreshing : refreshing
  const refreshActiveView = () => selectedProvider ? providerDetail.refresh() : refresh()

  return (
    <PageLayout>
      <PageHeader
        title={selectedProvider ? `${selectedProvider.providerName} 数据分析` : '统计分析'}
        description={selectedProvider ? '供应商请求质量、用量和模型表现' : '请求量、成功率、延迟等核心指标统计'}
        breadcrumbs={selectedProvider ? [{ label: '统计分析', onClick: () => setSelectedProvider(null) }, { label: selectedProvider.providerName }] : undefined}
        actions={(
          <div className="flex items-center gap-2">
            <Tabs value={timeRange} onValueChange={v => setTimeRange(v as AnalyticsRange)}>
              <TabsList className="h-7">
                <TabsTrigger value="today" className="h-6 px-2.5 text-xs">今日</TabsTrigger>
                <TabsTrigger value="7d" className="h-6 px-2.5 text-xs">近 7 天</TabsTrigger>
                <TabsTrigger value="30d" className="h-6 px-2.5 text-xs">近 30 天</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="icon-sm" title="刷新统计数据" aria-label="刷新统计数据" disabled={activeRefreshing} onClick={() => void refreshActiveView()}>
              <RefreshCw className={cn('size-3.5', activeRefreshing && 'animate-spin')} />
            </Button>
          </div>
        )}
      />
      <PageContent>
        {renderBody()}
      </PageContent>
    </PageLayout>
  )
}
