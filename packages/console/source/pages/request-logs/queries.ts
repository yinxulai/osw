import { useQuery, type QueryClient } from '@tanstack/react-query'
import { requestLogApi } from '@/api/observability'
import type { RequestLogBodies, RequestLogDetail, RequestLogEntry } from '@common/schemas'
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

/**
 * 落库的详情。
 *
 * `enabled` 用来在被展开的那一行**还在执行**时把它关掉：那时台账里已经有更全的实时数据，
 * 再按库里的半成品轮询一次纯属浪费——而且它的 `pending` 会让详情每 1.5s 重取一遍，
 * 重取的却是同一副空壳。
 */
export function useRequestLogDetailQuery(id: string | null, enabled = true) {
  return useQuery<RequestLogDetail>({
    queryKey: ['request-log-detail', id],
    queryFn: () => fetchDetail(id!),
    enabled: enabled && Boolean(id),
    staleTime: 1_000,
    refetchInterval: query => query.state.data?.status === 'pending' ? 1_500 : false,
  })
}

const requestLogBodiesQueryKey = (id: string) => ['request-log-bodies', id]

async function fetchBodies(id: string): Promise<RequestLogBodies> {
  const result = await requestLogApi.bodies(id)
  if (!result.success) throw new Error(result.errorMessage)
  return result.data
}

/**
 * 取回某个请求的全部正文，返回值同时进缓存，供后续直接命中。
 *
 * 「复制 cURL」要知道请求体，而它不进正文面板；点它同样是在要正文，所以就地取一次，
 * 而不是让按钮一直灰着——见 `request-log-detail-row.tsx`。
 */
export async function fetchRequestLogBodies(id: string, queryClient: QueryClient): Promise<RequestLogBodies> {
  return queryClient.fetchQuery({ queryKey: requestLogBodiesQueryKey(id), queryFn: () => fetchBodies(id) })
}

/**
 * 按需取正文——`id` 为空表示用户还没点开正文面板，此时一次都不请求。
 *
 * 正文是库里最大的列，而详情在请求还挂着时每 1.5s 轮询一次；正文因此从详情里剥离出来，
 * 只在用户真的要看的时候取（见 issue #23）。`poll` 用来在流式回包期间把它保持新鲜，
 * 请求一旦落定就停：那时正文已经写完，再取也只是重复解压同一份数据。
 */
export function useRequestLogBodiesQuery(id: string | null, poll = false) {
  return useQuery<RequestLogBodies>({
    queryKey: requestLogBodiesQueryKey(id ?? ''),
    queryFn: () => fetchBodies(id!),
    enabled: Boolean(id),
    staleTime: 1_000,
    refetchInterval: poll ? 1_500 : false,
  })
}
