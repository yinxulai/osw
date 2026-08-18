import { useCallback, useEffect, useState } from 'react'
import { analyticsApi } from '@/api'
import { useToast } from '@/components/ui/toast'
import type { AnalyticsRange, AnalyticsSummary } from '@common/schemas'

export function useOverviewService() {
  const toast = useToast()
  const [timeRange, setTimeRange] = useState<AnalyticsRange>('7d')
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async (range: AnalyticsRange) => {
    setLoading(true)
    const res = await analyticsApi.summary(range)
    if (!res.success) {
      toast.error(res.errorMessage)
      setLoading(false)
      return
    }
    setData(res.data)
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void loadData(timeRange)
  }, [timeRange, loadData])

  const hasData = data && data.summary.totalRequests > 0

  return {
    timeRange,
    setTimeRange,
    data,
    loading,
    hasData,
  }
}
