import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readLiveRequestStream } from '@/api/live-stream'
import type { LiveRequest } from '@common/schemas'

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
 * 断线重连是本地的：连接会因为应用重启、后台服务重启、空闲重连而结束，这些是**常态**
 * 而不是异常，所以重连不报错、只退避。
 */
export function LiveRequestsProvider(props: LiveRequestsProviderProps) {
  const { children, enabled } = props
  const [requests, setRequests] = useState<LiveRequest[] | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      setRequests(undefined)
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let stopped = false
    const connect = () => {
      if (stopped) return
      const connectedAt = Date.now()
      readLiveRequestStream({
        signal: controller.signal,
        onMessage: message => {
          if (message.type === 'snapshot') setRequests(message.requests)
        },
      })
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
  }, [enabled])

  const value = useMemo<LiveRequestsResult>(() => ({ data: requests }), [requests])
  return <LiveRequestsContext.Provider value={value}>{children}</LiveRequestsContext.Provider>
}

export function useLiveRequests(): LiveRequestsResult {
  const value = useContext(LiveRequestsContext)
  if (!value) throw new Error('useLiveRequests must be used inside LiveRequestsProvider')
  return value
}
