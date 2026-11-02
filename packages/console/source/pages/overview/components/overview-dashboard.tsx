import type { AnalyticsSummary, ProviderStat } from '@common/schemas'
import { StatsGrid } from './stats-grid'
import { UsageDistribution, type UsageDistributionMode } from './usage-distribution'
import { ProviderDistribution } from './provider-distribution'
import { ModelRanking } from './model-ranking'
import { LatencyDistribution } from './latency-distribution'
import { FailureReasons } from './failure-reasons'

interface OverviewDashboardProps {
  data: AnalyticsSummary
  distributionMode: UsageDistributionMode
  onDistributionModeChange: (mode: UsageDistributionMode) => void
  onSelectProvider: (provider: ProviderStat) => void
}

/** 统计分析正文：指标、供应商与用量、模型排行、延迟与失败原因。 */
export function OverviewDashboard(props: OverviewDashboardProps) {
  const { data } = props

  return (
    <>
      <div data-screenshot="overview-stats">
        <StatsGrid summary={data.summary} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        {/* 点击供应商 = 跳到 `/overview/$providerId`，range 原样带过去。 */}
        <ProviderDistribution stats={data.providerStats} onSelectProvider={props.onSelectProvider} />
        <UsageDistribution
          mode={props.distributionMode}
          onModeChange={props.onDistributionModeChange}
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
