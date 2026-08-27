import { useQueueMetricsQuery } from '../queries'

export function useQueueMetrics() {
  const query = useQueueMetricsQuery()
  return { modelMetrics: query.data?.modelMetrics ?? {}, summaryMetrics: query.data?.summaryMetrics, refresh: query.refetch }
}
