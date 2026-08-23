import { useQueueMetricsQuery } from '../queries'

export function useQueueMetrics() {
  const query = useQueueMetricsQuery()
  return { modelMetrics: query.data ?? {}, refresh: query.refetch }
}
