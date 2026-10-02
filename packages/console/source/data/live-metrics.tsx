import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readLiveMetricsStream } from '@/api/live-stream'
import type { LiveMetrics } from '@common/live-metrics'

/** 连接活得超过这么久才算「连得成」，此后重置退避计数。 */
const CONNECT_STABLE_MILLISECONDS = 10_000
/** 断线重连的起始退避。第一次重连不等，因为首次连接失败通常是应用还没把服务拉起来。 */
const RECONNECT_BASE_MILLISECONDS = 500
/** 退避上限。一直不成功也不必退得更远：这是本机服务，不是远端接口。 */
const RECONNECT_MAX_MILLISECONDS = 5_000

/** 实时指标订阅的返回值。刻意只有 `data`：它不是 react-query 的查询，没有重取也没有失败态。 */
export interface LiveMetricsResult {
  data: LiveMetrics | undefined
}

interface LiveMetricsProviderProps {
  children: ReactNode
  /** 只有需要实时指标的界面才挂载连接；关掉时立刻断开，不空转一条流。 */
  enabled: boolean
}

const LiveMetricsContext = createContext<LiveMetricsResult | null>(null)

/**
 * 实时指标（标准 {@link LiveMetrics}）。
 *
 * 走推送，与「进行中的请求」同构（见 `live-requests.tsx`）：服务端在指标变化时推 `snapshot`，
 * 空闲时只推不携带状态的 `heartbeat`。区别只在数据源——这条读的是
 * `/api/live-metrics/stream`，也就是菜单栏标题用的**同一份数**（服务进程内唯一计算点）。
 *
 * 指标是标准的、模板只有一份：窗口里的指标与菜单栏标题取的是同一帧，所以它们看起来会一致。
 * 谁来画、画在窗口的哪个位置，是调用方的事，不是指标的事。
 */
export function LiveMetricsProvider(props: LiveMetricsProviderProps) {
  const { children, enabled } = props
  const [metrics, setMetrics] = useState<LiveMetrics | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      setMetrics(undefined)
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let stopped = false
    const connect = () => {
      if (stopped) return
      const connectedAt = Date.now()
      readLiveMetricsStream({
        signal: controller.signal,
        onMessage: message => {
          if (message.type === 'snapshot') setMetrics(message.metrics)
        },
      })
        .catch(error => {
          if (controller.signal.aborted) return
          console.warn(`[console] live metrics stream ended: ${(error as Error).message}`)
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

  const value = useMemo<LiveMetricsResult>(() => ({ data: metrics }), [metrics])
  return <LiveMetricsContext.Provider value={value}>{children}</LiveMetricsContext.Provider>
}

export function useLiveMetrics(): LiveMetricsResult {
  const value = useContext(LiveMetricsContext)
  if (!value) throw new Error('useLiveMetrics must be used inside LiveMetricsProvider')
  return value
}
