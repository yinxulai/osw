import { BarChart3, Loader2 } from 'lucide-react'
import type { AnalyticsRange } from '@common/schemas'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { useOverviewService } from './service'
import { StatsGrid } from './components/stats-grid'
import { TrendChart } from './components/trend-chart'
import { ProviderDistribution } from './components/provider-distribution'
import { ModelRanking } from './components/model-ranking'
import { LatencyDistribution } from './components/latency-distribution'
import { FailureReasons } from './components/failure-reasons'

export function OverviewPage() {
  const { timeRange, setTimeRange, data, loading, hasData } = useOverviewService()

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
        {loading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={18} />
            加载中...
          </div>
        )}

        {!loading && !hasData && (
          <div className="text-center py-20 text-muted-foreground">
            <BarChart3 size={40} className="mx-auto mb-3 opacity-30" />
            <div className="text-sm">暂无统计数据</div>
            <div className="text-xs mt-1">发送一些请求后这里会显示统计信息</div>
          </div>
        )}

        {!loading && hasData && data && (
          <>
            <StatsGrid summary={data.summary} />

            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
              <TrendChart trend={data.trend} range={timeRange} />
              <ProviderDistribution stats={data.providerStats} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
              <ModelRanking stats={data.modelStats} />
              <LatencyDistribution buckets={data.latencyDistribution} />
            </div>

            <FailureReasons
              reasons={data.failureReasons}
              failedCount={data.summary.failedCount}
              successRate={data.summary.successRate}
            />
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
