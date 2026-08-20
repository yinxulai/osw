import { useCallback, useEffect, useRef, useState } from 'react'
import { requestLogApi, providerApi } from '@/api'
import { useLogicalModels, useAppPolling } from '@/services/app-hooks'
import { useAsyncFn } from '@/services/use-async'
import type { Provider, RequestLogEntry } from '@common/schemas'

export const PAGE_SIZE = 20

export interface RequestLogFilter {
  providerId: string
  protocol: string
  status: string
}

export function useRequestLogsService() {
  const logicalModels = useLogicalModels()
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [providers, setProviders] = useState<Provider[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const pageRef = useRef(1)
  const filterRef = useRef<RequestLogFilter>({ providerId: 'all', protocol: 'all', status: 'all' })

  // 确保逻辑模型数据可用（用于名称映射）
  useAppPolling('logicalModels', 30000)

  useEffect(() => {
    providerApi.list().then(result => {
      if (result.success) setProviders(result.data)
    }).catch(() => {})
  }, [])

  const { loading, run: load } = useAsyncFn(async (page?: number) => {
    const target = page ?? pageRef.current
    const filter = filterRef.current
    const result = await requestLogApi.list({
      limit: PAGE_SIZE,
      offset: (target - 1) * PAGE_SIZE,
      ...(filter.providerId !== 'all' ? { providerId: filter.providerId } : {}),
      ...(filter.protocol !== 'all' ? { protocol: filter.protocol } : {}),
      ...(filter.status !== 'all' ? { status: filter.status as 'pending' | 'success' | 'failed' | 'cancelled' } : {}),
    })
    if (!result.success) throw new Error(result.errorMessage)
    pageRef.current = target
    setLogs(result.data.logs)
    setTotal(result.data.total)
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

  const refresh = useCallback(async (page?: number) => {
    setRefreshing(true)
    try {
      await load(page)
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const setFilter = useCallback((next: Partial<RequestLogFilter>) => {
    filterRef.current = { ...filterRef.current, ...next }
    pageRef.current = 1
    return load(1)
  }, [load])

  const getModelName = useCallback((id: string) => {
    return logicalModels.find(m => m.id === id)?.name ?? id
  }, [logicalModels])

  return {
    logs,
    total,
    providers,
    loading,
    refreshing,
    getModelName,
    refresh,
    setFilter,
  }
}
