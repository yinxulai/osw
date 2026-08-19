import { useCallback, useEffect, useState } from 'react'
import { requestLogApi } from '@/api'
import { useToast } from '@/components/ui/toast'
import { useLogicalModels, useAppPolling } from '@/services/app-hooks'
import type { RequestLogEntry } from '@common/schemas'

export function useRequestLogsService() {
  const toast = useToast()
  const logicalModels = useLogicalModels()
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // 确保逻辑模型数据可用（用于名称映射）
  useAppPolling('logicalModels', 30000)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const result = await requestLogApi.list(50)
    if (!result.success) {
      toast.error(result.errorMessage)
      setLoading(false)
      return
    }
    setLogs(result.data.logs)
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load(false)
  }, [load])

  useEffect(() => {
    if (!logs.some(log => log.status === 'pending')) return
    const timer = window.setInterval(() => void load(true), 1_500)
    return () => window.clearInterval(timer)
  }, [load, logs])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
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
