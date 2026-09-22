import { useEffect, useState } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { requestLogApi } from '@/api/observability'
import { readLiveRequestStream } from '@/api/live-stream'
import type { LiveRequest, RequestLogBodies, RequestLogDetail, RequestLogEntry } from '@common/schemas'
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

/** 连接活得超过这么久才算「连得成」，此后重置退避计数。 */
const CONNECT_STABLE_MILLISECONDS = 10_000
/** 断线重连的起始退避。第一次重连不等，因为首次连接失败通常是应用还没把服务拉起来。 */
const RECONNECT_BASE_MILLISECONDS = 500
/** 退避上限。一直不成功也不必退得更远：这是本机服务，不是远端接口。 */
const RECONNECT_MAX_MILLISECONDS = 5_000

/** 进行中请求订阅的返回值。刻意只有 `data`：它不是 react-query 的查询，没有重取也没有失败态。 */
export interface LiveRequestsResult {
  data: LiveRequest[] | undefined
}

/**
 * 进行中的请求。
 *
 * 走推送，不再轮询：管理服务在台账发生变化时主动推一份全量快照，空闲时一个字节都不写。
 * 之前的轮询两头都不好——空闲时白拉（还得靠放慢间隔来省），有请求时又慢，
 * 最坏要等一个完整的轮询周期才看得到上游刚吐出来那几个字。
 *
 * 数据不进 react-query 缓存：这份东西没有 `staleTime` 可言，每一帧都是它自己的当下，
 * 缓存只会给「旧快照盖住新快照」创造机会。它也不参与失效——台账落定后自然从列表里消失，
 * 刷新另一侧（落库的日志）由那个查询自己负责。
 *
 * 断线重连是本地的：连接会因为应用重启、后台服务重启、空闲重连而结束，这些是**常态**
 * 而不是异常，所以重连不报错、只退避。
 */
export function useLiveRequests(): LiveRequestsResult {
  const [requests, setRequests] = useState<LiveRequest[] | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let stopped = false
    const connect = () => {
      if (stopped) return
      const connectedAt = Date.now()
      readLiveRequestStream({ signal: controller.signal, onSnapshot: snapshot => setRequests(snapshot.requests) })
        .catch(error => {
          if (controller.signal.aborted) return
          console.warn(`[console] live request stream ended: ${(error as Error).message}`)
        })
        .then(() => {
          if (stopped || controller.signal.aborted) return
          // 连够久才算这一次是成功的，否则一个「连上就断」的服务会永远停在首次退避那一档。
          if (Date.now() - connectedAt > CONNECT_STABLE_MILLISECONDS) failures = 0
          const delay = failures === 0 ? 0 : Math.min(RECONNECT_BASE_MILLISECONDS * 2 ** (failures - 1), RECONNECT_MAX_MILLISECONDS)
          failures += 1
          timer = setTimeout(connect, delay)
        })
    }
    connect()
    return () => {
      stopped = true
      controller.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [])
  return { data: requests }
}
