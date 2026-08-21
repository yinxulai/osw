import { BarChart3 } from 'lucide-react'
import type { AnalyticsRange } from '@common/schemas'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useOverviewService } from './service'
import { StatsGrid } from './components/stats-grid'
import { TrendChart } from './components/trend-chart'
import { ProviderDistribution } from './components/provider-distribution'
import { ModelRanking } from './components/model-ranking'
import { LatencyDistribution } from './components/latency-distribution'
import { FailureReasons } from './components/failure-reasons'

export function OverviewPage() {
  const { timeRange, setTimeRange, data, loading, hasData } = useOverviewService()

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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-40 w-full" />
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
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

  const renderEmpty = () => (
    <EmptyState
      icon={BarChart3}
      title="暂无统计数据"
      description="代理请求产生后，这里会显示请求量、成功率、延迟与模型分布。"
      className="min-h-72"
    />
  )

  const renderContent = () => {
    if (!data) return null
    return (
      <>
        <StatsGrid summary={data.summary} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <TrendChart trend={data.trend} range={timeRange} />
          <ProviderDistribution stats={data.providerStats} />
        </div>

        <ModelRanking stats={data.modelStats} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LatencyDistribution buckets={data.latencyDistribution} />
          <FailureReasons
            reasons={data.failureReasons}
            failedCount={data.summary.failedCount}
            successRate={data.summary.successRate}
          />
        </div>
      </>
    )
  }

  const renderBody = () => {
    if (loading) return renderLoading()
    if (!hasData) return renderEmpty()
    return renderContent()
  }

  return (
    <PageLayout>
      <PageHeader
        title="统计分析"
        description="请求量、成功率、延迟等核心指标统计"
        actions={(
          <Tabs value={timeRange} onValueChange={v => setTimeRange(v as AnalyticsRange)}>
            <TabsList className="h-7">
              <TabsTrigger value="today" className="h-6 px-2.5 text-xs">今日</TabsTrigger>
              <TabsTrigger value="7d" className="h-6 px-2.5 text-xs">近 7 天</TabsTrigger>
              <TabsTrigger value="30d" className="h-6 px-2.5 text-xs">近 30 天</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
      <PageContent>
        {renderBody()}
      </PageContent>
    </PageLayout>
  )
}
