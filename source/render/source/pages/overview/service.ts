import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import type { AnalyticsRange } from '@common/schemas'

export function useOverviewService(range: AnalyticsRange) {
  const query = useQuery({ queryKey: ['analytics', range], queryFn: () => unwrap(analyticsApi.summary(range)), refetchInterval: 15_000 })
  return {
    data: query.data ?? null,
    loading: query.isPending,
    refreshing: query.isFetching && !query.isPending,
    error: !query.data && query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
  }
}

export function useProviderAnalyticsDetail(providerId: string | null, range: AnalyticsRange) {
  const query = useQuery({
    queryKey: ['analytics', 'provider-detail', providerId, range],
    queryFn: () => unwrap(analyticsApi.providerDetail(providerId!, range)),
    enabled: Boolean(providerId),
    refetchInterval: 15_000,
  })
  return {
    data: query.data ?? null,
    loading: query.isPending,
    refreshing: query.isFetching && !query.isPending,
    error: !query.data && query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
  }
}
