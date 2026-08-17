import { useCallback, useEffect, useState } from 'react'
import { analyticsApi } from '@/api'
import type { AnalyticsRange, AnalyticsSummary } from '@common/schemas'

export function useOverviewService() {
  const [timeRange, setTimeRange] = useState<AnalyticsRange>('7d')
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const loadData = useCallback(async (range: AnalyticsRange) => {
    setLoading(true)
    setErrorMessage('')
    const res = await analyticsApi.summary(range)
    if (!res.success) {
      setErrorMessage(res.errorMessage)
      setLoading(false)
      return
    }
    setData(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData(timeRange)
  }, [timeRange, loadData])

  const hasData = data && data.summary.totalRequests > 0

  return {
    timeRange,
    setTimeRange,
    data,
    loading,
    errorMessage,
    hasData,
  }
}
