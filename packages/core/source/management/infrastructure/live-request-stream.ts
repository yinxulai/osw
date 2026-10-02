import type { ServerResponse } from 'node:http'
import { LIVE_REQUEST_STREAM_PROTOCOL_VERSION, type LiveRequestStreamMessage } from '@common/live-request-stream'
import { liveRequestStore } from '@server/proxy/observability/live-request-store'
import { createFanout } from '@server/realtime/stream-fanout'

/**
 * 「进行中的请求」的推送通道。
 *
 * ## 为什么是推送而不是轮询
 *
 * 这份数据只有一种消费方式：界面盯着它看，直到请求落定。此前的做法是每 1s（空闲时 3s）
 * 拉一次全量快照，于是「上游刚吐了一个字节」与「界面刚知道」之间必然差着最多一个轮询周期，
 * 而空闲时又白拉了一整份快照。改成推送后两件事一起解决：台账一变就推，台账不变一个字节都不写。
 *
 * ## 为什么不是 WebSocket
 *
 * 这个通道全程只从服务端往客户端走，客户端除了最初那次握手没有别的话要说。为此在管理服务里
 * 手写一遍 RFC 6455（握手 + 帧编解码 + 掩码 + 控制帧），顺带破掉「管理 API 只接 `/api/*` 的 POST」
 * 这条既有守卫，还得另写一份 Origin 校验——浏览器**不对 WebSocket 施加同源策略**，
 * 本机任意网页都能直接连上来读走这条流。换来的只是省下一条 HTTP 连接。
 * 而「`POST` + 分块响应」能拿到完全一样的东西：管理 API 的形状一条没变，
 * 守卫、CORS、路由匹配、错误边界全部原样复用（见 `core/request-guards.ts`）。
 *
 * ## 帧的形状
 *
 * 每帧一行版本化的 `LiveRequestStreamMessage`：
 *
 * - `snapshot` 携带完整状态，连接建立后的第一帧必定是它；
 * - `heartbeat` 只证明连接还活着，不携带也不暗示任何业务状态。
 *
 * 数据仍走全量快照，不做增量。理由见契约注释：进行中的请求是有限的一小撮，全量重发比在
 * 客户端重放增量简单得多，也天然免疫乱序与丢帧——一个慢客户端丢掉几帧之后，拿到的下一帧
 * 仍然是完整的、当下的真相。
 *
 * ## 内存与连接
 *
 * 订阅、合流、心跳、背压、收尾这些机制全都在 {@link createFanout} 里，
 * 这里只负责把「台账当前是什么样」和「一帧长什么样」两件事告诉它。
 * 节拍器在所有订阅者离开后立刻停掉，并且 `unref()` 过，
 * 因此「没人看」时这个通道既不占定时器、也不会把进程留在事件循环里。
 */
const fanout = createFanout<LiveRequestStreamMessage>({
  snapshot: () => ({
    protocolVersion: LIVE_REQUEST_STREAM_PROTOCOL_VERSION,
    type: 'snapshot',
    requests: liveRequestStore.list(),
  }),
  frameOf,
  heartbeatFrame: frameOf({ protocolVersion: LIVE_REQUEST_STREAM_PROTOCOL_VERSION, type: 'heartbeat' }),
  subscribe: listener => liveRequestStore.subscribe(listener),
})

/**
 * 把一个响应挂上推送通道，返回退订函数。
 *
 * 调用方负责把响应头先写好并保持连接不关闭；这里只管「什么时候写什么」，
 * 不碰状态码、不碰 `Content-Type`——那些是 HTTP 的事，属于路由那一层。
 */
export function attachLiveRequestStream(res: ServerResponse): () => void {
  return fanout.attach(res)
}

/** 一帧的字节：一条版本化消息。行尾必须有换行，客户端按行分帧。 */
function frameOf(message: LiveRequestStreamMessage): string {
  return `${JSON.stringify(message)}\n`
}
