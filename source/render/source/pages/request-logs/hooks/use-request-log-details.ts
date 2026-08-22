import { useCallback, useRef, useState } from 'react'
import { requestLogApi } from '@/api/observability'
import type { RequestLogDetail } from '@common/schemas'

export function useRequestLogDetails() {
  const [details, setDetails] = useState<Record<string, RequestLogDetail>>({})
  const [detailLoadingIds, setDetailLoadingIds] = useState<Record<string, boolean>>({})
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  const cacheRef = useRef(details)
  const loadingRef = useRef<Record<string, boolean>>({})
  const loadDetail = useCallback(async (id: string) => {
    if (cacheRef.current[id] || loadingRef.current[id]) return
    loadingRef.current[id] = true
    setDetailLoadingIds(current => ({ ...current, [id]: true }))
    setDetailErrors(current => ({ ...current, [id]: '' }))
    try {
      const result = await requestLogApi.detail(id)
      if (!result.success) throw new Error(result.errorMessage)
      cacheRef.current = { ...cacheRef.current, [id]: result.data }
      setDetails(cacheRef.current)
    } catch (error) {
      setDetailErrors(current => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }))
    } finally {
      loadingRef.current[id] = false
      setDetailLoadingIds(current => ({ ...current, [id]: false }))
    }
  }, [])
  return { details, detailLoadingIds, detailErrors, loadDetail }
}
