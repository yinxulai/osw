import { useCallback, useEffect, useRef, useState } from 'react'
import { requestLogApi } from '@/api/observability'
import { calculateQueueModelMetrics, type QueueModelMetrics } from '../lib/model-metrics'

export function useQueueMetrics() {
  const [modelMetrics, setModelMetrics] = useState<Record<string, QueueModelMetrics>>({})
  const initializedRef = useRef(false)
  const inflightRef = useRef(false)

  const refresh = useCallback(async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    try {
      const result = await requestLogApi.list({ limit: 100 })
      if (result.success) setModelMetrics(calculateQueueModelMetrics(result.data.logs))
    } finally {
      inflightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      void refresh()
    }
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return { modelMetrics, refresh }
}
