import { useCallback, useEffect, useState } from 'react'
import { requestLogApi } from '@/api'
import { useLogicalModels, useAppPolling } from '@/services/app-hooks'
import { useAsyncFn } from '@/services/use-async'
import type { RequestLogEntry } from '@common/schemas'

export function useRequestLogsService() {
  const logicalModels = useLogicalModels()
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [refreshing, setRefreshing] = useState(false)

  // 确保逻辑模型数据可用（用于名称映射）
  useAppPolling('logicalModels', 30000)

  const { loading, run: load } = useAsyncFn(async () => {
    const result = await requestLogApi.list(50)
    if (!result.success) throw new Error(result.errorMessage)
    setLogs(result.data.logs)
    return result.data.logs
  })

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!logs.some(log => log.status === 'pending')) return
    const timer = window.setInterval(() => void load(), 1_500)
    return () => window.clearInterval(timer)
  }, [load, logs])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const getModelName = useCallback((id: string) => {
    return logicalModels.find(m => m.id === id)?.name ?? id
  }, [logicalModels])

  return {
    logs,
    loading,
    refreshing,
    getModelName,
    refresh,
  }
}
