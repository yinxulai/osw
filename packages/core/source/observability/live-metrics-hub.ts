/**
 * 实时指标的**唯一计算点**（服务进程内）。
 *
 * 指标是标准的（`@common/live-metrics` 的 {@link LiveMetrics}），算它只需要一样东西：内存台账
 * （`liveRequestStore`）。台账只在服务进程里，所以计算必须发生在这里，而且**只能发生一次**——
 * 菜单栏标题与应用窗口角标是同一份数的两块画布，各算一遍迟早会算出两个不同的值。
 *
 * ## 谁在用
 *
 * - 主进程的菜单栏标题：`host/service-runtime.ts` 订阅本 hub，再经 `ServiceEvents` 的
 *   `live.metrics` 转发（托盘画在原生菜单栏上，只有主进程够得着）。
 * - 渲染进程的窗口角标：`management/infrastructure/live-metrics-stream.ts` 订阅本 hub，
 *   经 HTTP 分块响应推给界面。
 *
 * 两个出口共用同一个 hub，所以两边永远是同一帧。
 *
 * ## 生命周期与「谁需要它」
 *
 * hub 不主动跑：**有订阅者时才开始计算**（订阅台账、起节拍器），最后一个订阅者离开就全部收掉。
 * 开关的粒度由各出口自己决定（菜单栏开关、窗口开关），hub 不关心谁在看。
 *
 * ## 时间与去抖
 *
 * 订阅台账后，每次写入只标记「脏」，由节拍器在合流窗口后统一重算——流式响应每几毫秒写一次
 * 台账，逐次重算只会让数字每秒闪十几次。另外保留一个心跳，是因为速度是个**时间量**：没有新
 * Token 到达时台账不变，但 TPS 该随时间流逝自然回落，需要心跳给它一个衰减的出口。
 */

import { computeLiveMetrics, type LiveMetrics } from '@common/live-metrics'
import { liveRequestStore } from '../proxy/observability/live-request-store'

/** 台账变动到重算一帧的最大合流窗口。 */
const COALESCE_MILLISECONDS = 200
/** 空闲时的心跳间隔：给 TPS 一个随时间衰减的出口。 */
const HEARTBEAT_MILLISECONDS = 1000

type LiveMetricsListener = (metrics: LiveMetrics) => void

let latest: LiveMetrics | null = null
const listeners = new Set<LiveMetricsListener>()

let heartbeatTimer: NodeJS.Timeout | null = null
let coalesceTimer: NodeJS.Timeout | null = null
let unsubscribeStore: (() => void) | null = null

/** 上一次算出来的签名，用来挡掉「算了但数字没变」的空推。 */
let lastSignature: string | null = null

function snapshotOf(now: number): LiveMetrics {
  return computeLiveMetrics(liveRequestStore.list(), now)
}

/** 当前指标快照；还没有人订阅、或还没算出第一帧时为 `null`。 */
export function currentLiveMetrics(): LiveMetrics | null {
  return latest
}

/**
 * 订阅指标：订阅瞬间先收到一次当前值（有的话），之后每次变化收到新值。
 *
 * 第一个订阅者触发计算启动，最后一个离开触发停止。
 */
export function subscribeLiveMetrics(listener: LiveMetricsListener): () => void {
  if (listeners.size === 0) start()
  listeners.add(listener)
  if (latest !== null) listener(latest)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stop()
  }
}

function tick(): void {
  const metrics = snapshotOf(Date.now())
  const signature = `${metrics.liveMaxTps ?? '-'}|${metrics.liveTotalTps ?? '-'}|${metrics.activeRequests}`
  if (signature === lastSignature) return
  lastSignature = signature
  latest = metrics
  for (const listener of listeners) listener(metrics)
}

function markDirty(): void {
  if (coalesceTimer !== null) return
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null
    tick()
  }, COALESCE_MILLISECONDS)
  coalesceTimer.unref()
}

function start(): void {
  lastSignature = null
  heartbeatTimer = setInterval(tick, HEARTBEAT_MILLISECONDS)
  heartbeatTimer.unref()
  unsubscribeStore = liveRequestStore.subscribe(markDirty)
  tick()
}

function stop(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (coalesceTimer !== null) {
    clearTimeout(coalesceTimer)
    coalesceTimer = null
  }
  unsubscribeStore?.()
  unsubscribeStore = null
  lastSignature = null
  // 刻意保留 `latest`：下一个订阅者连上来时先拿到最近一帧，不必干等一个节拍。
}
