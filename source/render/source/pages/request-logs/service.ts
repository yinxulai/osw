import { useCallback, useState } from 'react'
import { useRequestLogDetails } from './hooks/use-request-log-details'
import { useRequestLogEntities } from './hooks/use-request-log-entities'
import { useRequestLogList } from './hooks/use-request-log-list'

export interface RequestLogFilter { providerId: string; logicalModelId: string; protocol: string; status: string; createdTimeFrom: number | null; createdTimeTo: number | null }

export function useRequestLogsService() {
  const list = useRequestLogList()
  const entities = useRequestLogEntities()
  const detail = useRequestLogDetails()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async (page?: number) => { setRefreshing(true); try { await list.load(page) } finally { setRefreshing(false) } }, [list.load])
  return { ...list, ...entities, ...detail, refreshing, refresh }
}
