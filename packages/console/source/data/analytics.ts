import { useQuery } from '@tanstack/react-query'
import type { AnalyticsRange, AnalyticsSummary } from '@common/schemas'
import { analyticsApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'

/**
 * 统计分析摘要。
 *
 * 与概览页共用同一条查询键（`['analytics', range]`），所以两个页面看的是同一份缓存：
 * 在概览页切过的范围、这里再打开时不用重新拉。轮询间隔也保持一致，避免同一份数据
 * 被两条不同节奏的定时器各自刷新。
 */
export function useAnalyticsSummary(range: AnalyticsRange) {
  const query = useQuery({
    queryKey: ['analytics', range],
    queryFn: () => unwrap(analyticsApi.summary(range)),
    refetchInterval: 15_000,
  })
  return {
    data: query.data as AnalyticsSummary | undefined,
    loading: query.isPending,
    error: !query.data && query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
  }
}
