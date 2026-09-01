import { useQuery, useQueryClient } from '@tanstack/react-query'
import { requestLogApi } from '@/api/observability'
import type { RequestLogDetail, RequestLogEntry } from '@common/schemas'
import type { RequestLogFilter } from './service'

export const PAGE_SIZE = 20

function toParams(filter: RequestLogFilter, page: number) {
  return {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    ...(filter.providerId !== 'all' ? { providerId: filter.providerId } : {}),
    ...(filter.providerModelId !== 'all' ? { providerModelId: filter.providerModelId } : {}),
    ...(filter.logicalModelId !== 'all' ? { logicalModelId: filter.logicalModelId } : {}),
    ...(filter.clientProtocol !== 'all' ? { clientProtocol: filter.clientProtocol } : {}),
    ...(filter.status !== 'all' ? { status: filter.status as 'pending' | 'success' | 'failed' | 'cancelled' } : {}),
    ...(filter.createdTimeFrom !== null ? { createdTimeFrom: filter.createdTimeFrom } : {}),
    ...(filter.createdTimeTo !== null ? { createdTimeTo: filter.createdTimeTo } : {}),
  }
}

async function fetchLogs(filter: RequestLogFilter, page: number) {
  const result = await requestLogApi.list(toParams(filter, page))
  if (!result.success) throw new Error(result.errorMessage)
  return result.data
}

async function fetchDetail(id: string): Promise<RequestLogDetail> {
  const result = await requestLogApi.detail(id)
  if (!result.success) throw new Error(result.errorMessage)
  return result.data
}

export function useRequestLogsQuery(filter: RequestLogFilter, page: number) {
  return useQuery<{ logs: RequestLogEntry[]; total: number }>({
    queryKey: ['request-logs', filter, page],
    queryFn: () => fetchLogs(filter, page),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => query.state.data?.logs.some((log) => log.status === 'pending') ? 1_500 : false,
  })
}

export function useRequestLogDetailQuery(id: string | null) {
  return useQuery<RequestLogDetail>({
    queryKey: ['request-log-detail', id],
    queryFn: () => fetchDetail(id!),
    enabled: Boolean(id),
    staleTime: 1_000,
    refetchInterval: query => query.state.data?.status === 'pending' ? 1_500 : false,
  })
}

export function useRefreshRequestLogs() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['request-logs'] })
}
