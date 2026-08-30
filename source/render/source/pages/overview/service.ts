import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { analyticsApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import type { AnalyticsRange } from '@common/schemas'

const useOverviewStore = create<{ timeRange: AnalyticsRange; setTimeRange: (range: AnalyticsRange) => void }>(set => ({ timeRange: '7d', setTimeRange: timeRange => set({ timeRange }) }))

export function useOverviewService() {
  const timeRange = useOverviewStore(state => state.timeRange)
  const setTimeRange = useOverviewStore(state => state.setTimeRange)
  const query = useQuery({ queryKey: ['analytics', timeRange], queryFn: () => unwrap(analyticsApi.summary(timeRange)), refetchInterval: 15_000 })
  return {
    timeRange,
    setTimeRange,
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
