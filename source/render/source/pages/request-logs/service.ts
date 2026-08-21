import { useCallback, useEffect, useRef, useState } from 'react'
import { requestLogApi, providerApi } from '@/api'
import { useLogicalModels, useAppPolling } from '@/services/app-hooks'
import { useAsyncFn } from '@/services/use-async'
import type { Provider, RequestLogDetail, RequestLogEntry } from '@common/schemas'

export const PAGE_SIZE = 20

export interface RequestLogFilter {
  providerId: string
  logicalModelId: string
  protocol: string
  status: string
  createdTimeFrom: number | null
  createdTimeTo: number | null
}

export function useRequestLogsService() {
  const logicalModels = useLogicalModels()
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [providers, setProviders] = useState<Provider[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [details, setDetails] = useState<Record<string, RequestLogDetail>>({})
  const [detailLoadingIds, setDetailLoadingIds] = useState<Record<string, boolean>>({})
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const pageRef = useRef(1)
  const filterRef = useRef<RequestLogFilter>({ providerId: 'all', logicalModelId: 'all', protocol: 'all', status: 'all', createdTimeFrom: null, createdTimeTo: null })

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
      ...(filter.logicalModelId !== 'all' ? { logicalModelId: filter.logicalModelId } : {}),
      ...(filter.protocol !== 'all' ? { protocol: filter.protocol } : {}),
      ...(filter.status !== 'all' ? { status: filter.status as 'pending' | 'success' | 'failed' | 'cancelled' } : {}),
      ...(filter.createdTimeFrom !== null ? { createdTimeFrom: filter.createdTimeFrom } : {}),
      ...(filter.createdTimeTo !== null ? { createdTimeTo: filter.createdTimeTo } : {}),
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

  const loadDetail = useCallback(async (id: string) => {
    if (details[id] || detailLoadingIds[id]) return
    setDetailLoadingIds(current => ({ ...current, [id]: true }))
    setDetailErrors(current => ({ ...current, [id]: '' }))
    try {
      const result = await requestLogApi.detail(id)
      if (!result.success) throw new Error(result.errorMessage)
      setDetails(current => ({ ...current, [id]: result.data }))
    } catch (error) {
      setDetailErrors(current => ({ ...current, [id]: (error as Error).message }))
    } finally {
      setDetailLoadingIds(current => ({ ...current, [id]: false }))
    }
  }, [detailLoadingIds, details])

  return {
    logs,
    total,
    providers,
    logicalModels,
    loading,
    refreshing,
    details,
    detailLoadingIds,
    detailErrors,
    getModelName,
    loadDetail,
    refresh,
    setFilter,
  }
}
