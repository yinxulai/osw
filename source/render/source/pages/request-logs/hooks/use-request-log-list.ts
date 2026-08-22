import { useCallback, useEffect, useRef, useState } from 'react'
import { requestLogApi } from '@/api/observability'
import { useAsyncFn } from '@/services/use-async'
import type { RequestLogEntry } from '@common/schemas'
import type { RequestLogFilter } from '../service'

export const PAGE_SIZE = 20

export function useRequestLogList() {
  const [logs, setLogs] = useState<RequestLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const pageRef = useRef(1)
  const filterRef = useRef<RequestLogFilter>({ providerId: 'all', logicalModelId: 'all', protocol: 'all', status: 'all', createdTimeFrom: null, createdTimeTo: null })
  const inFlightRef = useRef(false)
  const initializedRef = useRef(false)

  const { loading, run: runLoad } = useAsyncFn(async (page?: number) => {
    const target = page ?? pageRef.current
    if (inFlightRef.current) return []
    inFlightRef.current = true
    try {
      const filter = filterRef.current
      const result = await requestLogApi.list({ limit: PAGE_SIZE, offset: (target - 1) * PAGE_SIZE, ...(filter.providerId !== 'all' ? { providerId: filter.providerId } : {}), ...(filter.logicalModelId !== 'all' ? { logicalModelId: filter.logicalModelId } : {}), ...(filter.protocol !== 'all' ? { protocol: filter.protocol } : {}), ...(filter.status !== 'all' ? { status: filter.status as 'pending' | 'success' | 'failed' | 'cancelled' } : {}), ...(filter.createdTimeFrom !== null ? { createdTimeFrom: filter.createdTimeFrom } : {}), ...(filter.createdTimeTo !== null ? { createdTimeTo: filter.createdTimeTo } : {}) })
      if (!result.success) throw new Error(result.errorMessage)
      pageRef.current = target
      setLogs(result.data.logs)
      setTotal(result.data.total)
      return result.data.logs
    } finally {
      inFlightRef.current = false
      initializedRef.current = true
    }
  })

  useEffect(() => { void runLoad() }, [runLoad])
  useEffect(() => {
    if (!initializedRef.current || !logs.some(log => log.status === 'pending')) return
    const timer = window.setInterval(() => { void runLoad() }, 1_500)
    return () => window.clearInterval(timer)
  }, [logs, runLoad])

  const load = useCallback((page?: number) => runLoad(page), [runLoad])
  const setFilter = useCallback((next: Partial<RequestLogFilter>) => { filterRef.current = { ...filterRef.current, ...next }; pageRef.current = 1; return runLoad(1) }, [runLoad])
  return { logs, total, loading, load, setFilter }
}
