import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readLiveRequestStream } from '@/api/live-stream'
import { useResilientStream } from '@/data/use-resilient-stream'
import type { LiveRequest } from '@common/schemas'

/** 进行中请求订阅的返回值。刻意只有 `data`：它不是 react-query 的查询，没有重取也没有失败态。 */
export interface LiveRequestsResult {
  data: LiveRequest[] | undefined
}

interface LiveRequestsProviderProps {
  children: ReactNode
  /** 只有需要实时请求的页面挂载连接；在两类页面之间切换时保持同一条流。 */
  enabled: boolean
}

const LiveRequestsContext = createContext<LiveRequestsResult | null>(null)

/**
 * 进行中的请求。
 *
 * 走推送，不再轮询：管理服务在台账发生变化时主动推 `snapshot`，空闲时只推不携带状态的
 * `heartbeat`。只有快照会替换界面状态，心跳只负责证明连接还活着。
 * 连接由应用级 Provider 持有，因此请求日志页和逻辑模型页共用同一条流，不会各自开一条。
 *
 * 数据不进 react-query 缓存：这份东西没有 `staleTime` 可言，每一帧都是它自己的当下，
 * 缓存只会给「旧快照盖住新快照」创造机会。它也不参与失效——台账落定后自然从列表里消失，
 * 刷新另一侧（落库的日志）由那个查询自己负责。
 *
 * 断线重连交给 {@link useResilientStream}（与实时指标共用同一份退避逻辑）：连接会因为
 * 应用重启、后台服务重启、空闲重连而结束，这些是**常态**而不是异常，所以重连不报错、只退避。
 */
export function LiveRequestsProvider(props: LiveRequestsProviderProps) {
  const { children, enabled } = props
  const [requests, setRequests] = useState<LiveRequest[] | undefined>(undefined)

  useEffect(() => {
    if (!enabled) setRequests(undefined)
  }, [enabled])

  useResilientStream({
    enabled,
    read: readLiveRequestStream,
    onMessage: message => {
      if (message.type === 'snapshot') setRequests(message.requests)
    },
  })

  const value = useMemo<LiveRequestsResult>(() => ({ data: requests }), [requests])
  return <LiveRequestsContext.Provider value={value}>{children}</LiveRequestsContext.Provider>
}

export function useLiveRequests(): LiveRequestsResult {
  const value = useContext(LiveRequestsContext)
  if (!value) throw new Error('useLiveRequests must be used inside LiveRequestsProvider')
  return value
}
