import { useCallback, useEffect, useState } from 'react'
import { requestLogApi, logicalModelApi } from '@/api'
import { useToast } from '@/components/ui/toast'
import type { RequestLogEntry, LogicalModel } from '@common/schemas'

export function useRequestLogsService() {
  const toast = useToast()
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [logicalModels, setLogicalModels] = useState<LogicalModel[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const [result, modelsResult] = await Promise.all([
      requestLogApi.list(50),
      logicalModelApi.list(),
    ])
    if (!result.success) {
      toast.error(result.errorMessage)
      setLoading(false)
      return
    }
    if (modelsResult.success) {
      setLogicalModels(modelsResult.data)
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
