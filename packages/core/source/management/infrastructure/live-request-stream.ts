import type { ServerResponse } from 'node:http'
import { liveRequestStore } from '@server/proxy/observability/live-request-store'

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
 * 每帧一行 `LiveRequestSnapshot` 的 JSON 文本，即**全量快照**，不做增量。理由见契约注释：
 * 进行中的请求是有限的一小撮，全量重发比在客户端重放增量简单得多，也天然免疫乱序与丢帧——
 * 一个慢客户端丢掉几帧之后，拿到的下一帧仍然是完整的、当下的真相。
 *
 * ## 内存与连接
 *
 * 订阅者就是那条响应本身。节拍器在所有订阅者离开后立刻停掉，并且 `unref()` 过，
 * 因此「没人看」时这个通道既不占定时器、也不会把进程留在事件循环里。
 */

/** 台账一变最多攒多久再推：给突发写入一个合流窗口，也让界面每秒最多只被唤醒几次。 */
const FRAME_INTERVAL_MILLISECONDS = 150
/** 台账一直没变时也要推一帧的间隔：既当心跳，也让客户端能确认自己还连着。 */
const HEARTBEAT_MILLISECONDS = 10_000

interface LiveStreamSubscriber {
  res: ServerResponse
  /** 上一次写入没被内核缓冲区吃下：这一帧先跳过，等 `drain` 再补。 */
  blocked: boolean
}

const subscribers = new Set<LiveStreamSubscriber>()
let timer: NodeJS.Timeout | null = null
let unsubscribeStore: (() => void) | null = null
/** 台账自上一帧以来变过没有。 */
let dirty = false
let lastFrameAt = 0

/**
 * 把一个响应挂上推送通道，返回退订函数。
 *
 * 调用方负责把响应头先写好并保持连接不关闭；这里只管「什么时候写什么」，
 * 不碰状态码、不碰 `Content-Type`——那些是 HTTP 的事，属于路由那一层。
 */
export function attachLiveRequestStream(res: ServerResponse): () => void {
  const subscriber: LiveStreamSubscriber = { res, blocked: false }
  // 从「没人看」变成「有人在看」时才去订阅台账：没人看的时候连订阅都不该存在。
  if (subscribers.size === 0) unsubscribeStore = liveRequestStore.subscribe(markDirty)
  subscribers.add(subscriber)

  const onDrain = () => {
    subscriber.blocked = false
    // 被背压压掉的那一帧背后是一次真实的变更，补一帧。
    markDirty()
  }
  res.on('drain', onDrain)
  ensureTimer()
  // 立刻给一份：新连上来的客户端不该为了第一帧再等一个节拍。
  writeFrameTo(subscriber)

  return () => {
    res.off('drain', onDrain)
    detach(subscriber)
  }
}

/** 摘掉一个订阅者；最后一个人走的时候连节拍器与台账订阅一起收掉。 */
function detach(subscriber: LiveStreamSubscriber): void {
  subscribers.delete(subscriber)
  if (subscribers.size > 0) return
  unsubscribeStore?.()
  unsubscribeStore = null
  stopTimer()
}

function markDirty(): void {
  dirty = true
}

function ensureTimer(): void {
  if (timer !== null) return
  timer = setInterval(tick, FRAME_INTERVAL_MILLISECONDS)
  // 没人看的时候这个节拍器不该把进程留在事件循环里。
  timer.unref()
}

function stopTimer(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function tick(): void {
  if (subscribers.size === 0) {
    stopTimer()
    return
  }
  if (dirty || Date.now() - lastFrameAt >= HEARTBEAT_MILLISECONDS) writeFrame()
}

/** 给所有人推一帧。快照只取一次、只序列化一次，多个订阅者共用同一份字节。 */
function writeFrame(): void {
  const payload = frameOf()
  lastFrameAt = Date.now()
  dirty = false
  // 先拷贝一份再遍历：写失败会就地摘人，边遍历边改集合会漏掉后面的订阅者。
  for (const subscriber of [...subscribers]) {
    if (subscriber.blocked) continue
    writeTo(subscriber, payload)
  }
}

/** 给单独一个人推一帧（新连上来的那个）。 */
function writeFrameTo(subscriber: LiveStreamSubscriber): void {
  // 只把这一刻记成「刚推过」，**不能**顺手清掉 `dirty`：`dirty` 的意思是「有人在等这一帧」，
  // 而这一帧只发给了刚连上来的那个人，别的人还没拿到——清了就等于替他们吃掉一次变更，
  // 他们要一直等到下一次心跳（最多 10 秒）才发现台账早就变了。
  lastFrameAt = Date.now()
  writeTo(subscriber, frameOf())
}

function writeTo(subscriber: LiveStreamSubscriber, payload: string): void {
  const { res } = subscriber
  if (res.writableEnded || res.destroyed) {
    detach(subscriber)
    return
  }
  try {
    subscriber.blocked = !res.write(payload)
  } catch (error) {
    // 对端刚好在这两次判断之间消失时，写一个正在死掉的 socket 不该把服务进程带走。
    console.debug(`[management] live request frame dropped: ${(error as Error).message}`)
    detach(subscriber)
  }
}

/** 一帧的字节：一行完整的快照。行尾必须有换行，客户端按行分帧。 */
function frameOf(): string {
  return `${JSON.stringify({ requests: liveRequestStore.list() })}\n`
}
