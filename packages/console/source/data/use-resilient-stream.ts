import { useEffect, useRef } from 'react'

/** 连接活得超过这么久才算「连得成」，此后重置退避计数。 */
const CONNECT_STABLE_MILLISECONDS = 10_000
/** 断线重连的起始退避。第一次重连不等，因为首次连接失败通常是应用还没把服务拉起来。 */
const RECONNECT_BASE_MILLISECONDS = 500
/** 退避上限。一直不成功也不必退得更远：这是本机服务，不是远端接口。 */
const RECONNECT_MAX_MILLISECONDS = 5_000

/** 一条长活流的读法：建立连接，解析出的每条消息回调给 `onMessage`；返回的 Promise 在流结束时 resolve。 */
interface StreamReader<Message> {
  (args: { signal: AbortSignal; onMessage: (message: Message) => void }): Promise<void>
}

interface ResilientStreamOptions<Message> {
  /** 关掉时立刻断开，不空转一条流。 */
  enabled: boolean
  /** 建立一次连接（`readLiveRequestStream` / `readLiveMetricsStream`）。 */
  read: StreamReader<Message>
  /** 每解析出一条消息调用一次。 */
  onMessage: (message: Message) => void
}

/**
 * 把一条「连上就推、断了就退避重连」的 NDJSON 流接进 React。
 *
 * 「进行中的请求」与「实时指标」是两条不同的流，但**重连**是同一件事：连接会因应用重启、
 * 后台服务重启、空闲被断而结束，这些是**常态**而不是异常，所以重连不报错、只退避。此前这套
 * 逻辑在两个 Provider（`live-requests.tsx` / `live-metrics.tsx`）里逐字各写了一遍，这里只留
 * 一份——任何一处退避策略的修正都不必再记得改两遍。
 *
 * 退避策略：连够 {@link CONNECT_STABLE_MILLISECONDS} 才算这一次成功、把失败计数清零；
 * 否则按 {@link RECONNECT_BASE_MILLISECONDS} 指数退避，封顶 {@link RECONNECT_MAX_MILLISECONDS}。
 * 第一次重连不等，因为首次连接失败通常只是应用还没把服务拉起来。
 *
 * `read` / `onMessage` 走 ref 取最新值，因此 effect 只随 `enabled` 重连——内联箭头函数每次渲染
 * 都是新引用，若进依赖数组会让这条流被反复掐断重开。
 */
export function useResilientStream<Message>(options: ResilientStreamOptions<Message>): void {
  const { enabled, read, onMessage } = options
  // 只记最新值，不进依赖：否则每次渲染的新函数引用都会触发重连。
  const latest = useRef({ read, onMessage })
  latest.current = { read, onMessage }

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let stopped = false
    const connect = () => {
      if (stopped) return
      const connectedAt = Date.now()
      latest.current
        .read({
          signal: controller.signal,
          onMessage: message => latest.current.onMessage(message),
        })
        .catch(error => {
          if (controller.signal.aborted) return
          console.warn(`[console] live stream ended: ${(error as Error).message}`)
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
}
