import type { ServerResponse } from 'node:http'
import { LIVE_METRICS_STREAM_PROTOCOL_VERSION, type LiveMetricsStreamMessage } from '@common/live-metrics-stream'
import type { LiveMetrics } from '@common/live-metrics'
import { subscribeLiveMetrics } from '@server/observability/live-metrics-hub'

/**
 * 实时指标的 HTTP 推送通道（给渲染进程的窗口角标）。
 *
 * 与「进行中的请求」那条流（`live-request-stream.ts`）同构，区别只在数据源：那条直接订阅台账、
 * 自己算节奏；这条订阅 {@link subscribeLiveMetrics}（服务进程内唯一的指标计算点），
 * 只负责把 hub 推来的每一帧写成一个 NDJSON 行。菜单栏标题走的是另一条出口（`ServiceEvents`），
 * 但两者订阅的是同一个 hub，所以窗口角标与菜单栏标题永远是同一份数。
 *
 * ## 为什么这里还有心跳
 *
 * hub 只在指标**真的变了**时才推。
 * 但连接需要一条「你还活着」的信号——否则界面无法区分「服务在跑但指标一直没变」与「连接悄悄断了」。
 * 所以这里自带一个低频心跳帧，与 hub 的推帧互不干扰。
 *
 * ## 内存与连接
 *
 * 订阅者就是那条响应本身。每个订阅者各自持有一个 hub 订阅，第一个订阅者让 hub 开始计算、
 * 最后一个离开让它停下。心跳定时器在没人看时立刻收掉，并 `unref()` 过，不把进程留在事件循环里。
 */

/** 无状态心跳的间隔：够界面确认连接还活着，又不至于让一帧都没有的连接显得吵。 */
const HEARTBEAT_MILLISECONDS = 10_000

interface LiveMetricsSubscriber {
  res: ServerResponse
  unsubscribeHub: () => void
  /** 上一次写入没被内核缓冲区吃下：这一帧先跳过，等 `drain` 再补。 */
  blocked: boolean
  /** 最新一帧（背压期间攒下来，`drain` 时补发）。 */
  pending: string | null
  /** 心跳定时器；构造期先置空，随后立刻补上（避免在初始化表达式里自引用 `subscriber`）。 */
  heartbeat: NodeJS.Timeout | null
}

const subscribers = new Set<LiveMetricsSubscriber>()

/**
 * 把一个响应挂上指标推送通道，返回退订函数。
 *
 * 调用方负责把响应头先写好并保持连接不关闭；这里只管「什么时候写什么」，
 * 不碰状态码、不碰 `Content-Type`——那些是 HTTP 的事，属于路由那一层。
 */
export function attachLiveMetricsStream(res: ServerResponse): () => void {
  const subscriber: LiveMetricsSubscriber = {
    res,
    unsubscribeHub: () => undefined,
    blocked: false,
    pending: null,
    heartbeat: null,
  }
  subscriber.heartbeat = setInterval(() => writeTo(subscriber, heartbeatFrame), HEARTBEAT_MILLISECONDS)
  subscriber.heartbeat.unref()

  const onDrain = () => {
    subscriber.blocked = false
    if (subscriber.pending !== null) {
      const payload = subscriber.pending
      subscriber.pending = null
      writeTo(subscriber, payload)
    }
  }
  res.on('drain', onDrain)

  // 订阅瞬间 hub 会同步回灌一次当前帧（如果已经算出来过），所以新连上来的客户端不必等一个节拍。
  subscriber.unsubscribeHub = subscribeLiveMetrics(metrics => writeTo(subscriber, snapshotFrameOf(metrics)))
  subscribers.add(subscriber)

  return () => {
    res.off('drain', onDrain)
    detach(subscriber)
  }
}

/** 摘掉一个订阅者；最后一个人走的时候连心跳与 hub 订阅一起收掉。 */
function detach(subscriber: LiveMetricsSubscriber): void {
  if (!subscribers.delete(subscriber)) return
  if (subscriber.heartbeat !== null) clearInterval(subscriber.heartbeat)
  subscriber.unsubscribeHub()
}

function writeTo(subscriber: LiveMetricsSubscriber, payload: string): void {
  const { res } = subscriber
  if (res.writableEnded || res.destroyed) {
    detach(subscriber)
    return
  }
  // 背压下只保留**最新**一帧：指标是「此刻」的，补发一串过期帧没有意义。
  if (subscriber.blocked) {
    subscriber.pending = payload
    return
  }
  try {
    subscriber.blocked = !res.write(payload)
  } catch (error) {
    // 对端刚好在这两次判断之间消失时，写一个正在死掉的 socket 不该把服务进程带走。
    console.debug(`[management] live metrics frame dropped: ${(error as Error).message}`)
    detach(subscriber)
  }
}

/** 一帧的字节：一条版本化消息。行尾必须有换行，客户端按行分帧。 */
function frameOf(message: LiveMetricsStreamMessage): string {
  return `${JSON.stringify(message)}\n`
}

/** 指标快照帧。 */
function snapshotFrameOf(metrics: LiveMetrics): string {
  return frameOf({
    protocolVersion: LIVE_METRICS_STREAM_PROTOCOL_VERSION,
    type: 'snapshot',
    metrics,
  })
}

/** 无状态心跳只序列化一次；所有连接、所有心跳共用同一份字节。 */
const heartbeatFrame = frameOf({
  protocolVersion: LIVE_METRICS_STREAM_PROTOCOL_VERSION,
  type: 'heartbeat',
})
