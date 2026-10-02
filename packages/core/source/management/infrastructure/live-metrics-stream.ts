import type { ServerResponse } from 'node:http'
import { LIVE_METRICS_STREAM_PROTOCOL_VERSION, type LiveMetricsStreamMessage } from '@common/live-metrics-stream'
import type { LiveMetrics } from '@common/live-metrics'
import { currentLiveMetrics, subscribeLiveMetrics } from '@server/observability/live-metrics-hub'
import { createFanout } from '@server/realtime/stream-fanout'
import { STREAM_FRAME_INTERVAL_MILLISECONDS } from '@server/realtime/retention'

/**
 * 实时指标的 HTTP 推送通道（给渲染进程的窗口角标）。
 *
 * 与「进行中的请求」那条流（`live-request-stream.ts`）同构，区别只在数据源：那条直接订阅台账、
 * 用默认的合流窗口；这条订阅 {@link subscribeLiveMetrics}（服务进程内唯一的指标计算点），
 * 只负责把 hub 推来的每一帧写成一个 NDJSON 行。菜单栏标题走的是另一条出口（`ServiceEvents`），
 * 但两者订阅的是同一个 hub，所以窗口角标与菜单栏标题永远是同一份数。
 *
 * 传输层面（订阅、合流、心跳、背压、收尾）全在 {@link createFanout} 里，这里只描述数据源与帧形状。
 *
 * ## 为什么这里的心跳间隔与合流窗口都取默认值
 *
 * hub 只在指标**真的变了**时才推，所以合流窗口几乎不会生效（一帧就是一次真实变化）；
 * 保留它只是沿用统一口径。心跳则承担「你还活着」的信号——否则界面无法区分
 * 「服务在跑但指标一直没变」与「连接悄悄断了」。
 *
 * ## 内存与连接
 *
 * 订阅者就是那条响应本身。通道级只向 hub 订阅一次（第一个订阅者到来时），最后一个离开时退订；
 * 节拍器同理，且 `unref()` 过，不把进程留在事件循环里。
 */
const fanout = createFanout<LiveMetricsStreamMessage>({
  snapshot: () => ({
    protocolVersion: LIVE_METRICS_STREAM_PROTOCOL_VERSION,
    type: 'snapshot',
    metrics: currentMetrics(),
  }),
  frameOf,
  heartbeatFrame: frameOf({ protocolVersion: LIVE_METRICS_STREAM_PROTOCOL_VERSION, type: 'heartbeat' }),
  subscribe: listener => subscribeLiveMetrics(listener),
  // 指标帧由 hub 定节奏推来；这里不额外攒帧，只保留节拍器的去抖口径。
  frameIntervalMilliseconds: STREAM_FRAME_INTERVAL_MILLISECONDS,
})

/**
 * 把一个响应挂上指标推送通道，返回退订函数。
 *
 * 调用方负责把响应头先写好并保持连接不关闭；这里只管「什么时候写什么」，
 * 不碰状态码、不碰 `Content-Type`——那些是 HTTP 的事，属于路由那一层。
 */
export function attachLiveMetricsStream(res: ServerResponse): () => void {
  return fanout.attach(res)
}

/**
 * 订阅回调不带参数，但快照要从 hub 的最新值取。
 *
 * 取「最新一帧」而不是让 hub 把 metrics 传进来：通道本就是「推全量快照」，而 `subscribeLiveMetrics`
 * 在订阅瞬间会同步回灌一次当前值，所以新客户端不必等一个节拍；此后的每次回调只是把通道标脏，
 * 真正的取数留到节拍器里——那时读到的才是此刻的 `currentLiveMetrics()`。
 */
function currentMetrics(): LiveMetrics {
  const metrics = currentLiveMetrics()
  if (metrics !== null) return metrics
  // 首帧一定来自「订阅瞬间的同步回灌」，走到这里前 hub 必然已经算出过一帧；兜底用零值，
  // 让协议形状永远成立（否则要么类型撒谎、要么整条流的负载类型被迫变成可空）。
  return { activeRequests: 0, liveTps: null }
}

/** 一帧的字节：一条版本化消息。行尾必须有换行，客户端按行分帧。 */
function frameOf(message: LiveMetricsStreamMessage): string {
  return `${JSON.stringify(message)}\n`
}
