import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readLiveMetricsStream } from '@/api/live-stream'
import { useResilientStream } from '@/data/use-resilient-stream'
import type { LiveMetrics } from '@common/live-metrics'

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
 *
 * 断线重连交给 {@link useResilientStream}（与「进行中的请求」共用同一份退避逻辑）。
 */
export function LiveMetricsProvider(props: LiveMetricsProviderProps) {
  const { children, enabled } = props
  const [metrics, setMetrics] = useState<LiveMetrics | undefined>(undefined)

  useEffect(() => {
    if (!enabled) setMetrics(undefined)
  }, [enabled])

  useResilientStream({
    enabled,
    read: readLiveMetricsStream,
    onMessage: message => {
      if (message.type === 'snapshot') setMetrics(message.metrics)
    },
  })

  const value = useMemo<LiveMetricsResult>(() => ({ data: metrics }), [metrics])
  return <LiveMetricsContext.Provider value={value}>{children}</LiveMetricsContext.Provider>
}

export function useLiveMetrics(): LiveMetricsResult {
  const value = useContext(LiveMetricsContext)
  if (!value) throw new Error('useLiveMetrics must be used inside LiveMetricsProvider')
  return value
}
