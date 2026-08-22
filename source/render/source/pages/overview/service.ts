import { useState } from 'react'
import { analyticsApi } from '@/api/observability'
import { useAsyncData } from '@/services/use-async'
import type { AnalyticsRange } from '@common/schemas'

export function useOverviewService() {
  const [timeRange, setTimeRange] = useState<AnalyticsRange>('7d')

  const { data, loading } = useAsyncData(
    () => analyticsApi.summary(timeRange).then(result => {
      if (!result.success) throw new Error(result.errorMessage)
      return result.data
    }),
    [timeRange],
  )

  const hasData = data && data.summary.totalRequests > 0

  return {
    timeRange,
    setTimeRange,
    data,
    loading,
    hasData,
  }
}
