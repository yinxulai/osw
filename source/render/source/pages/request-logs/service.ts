import { useCallback, useEffect, useState } from 'react'
import { requestLogApi } from '@/api'
import type { RequestLogEntry } from '@common/schemas'

export function useRequestLogsService() {
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setErrorMessage('')
    const result = await requestLogApi.list(50)
    if (!result.success) {
      setErrorMessage(result.errorMessage)
      setLoading(false)
      return
    }
    setLogs(result.data.logs)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }, [load])

  return {
    logs,
    loading,
    refreshing,
    errorMessage,
    refresh,
  }
}
