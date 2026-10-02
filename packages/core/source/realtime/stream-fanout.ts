import type { ServerResponse } from 'node:http'
import { STREAM_FRAME_INTERVAL_MILLISECONDS, STREAM_HEARTBEAT_MILLISECONDS } from './retention'

/**
 * NDJSON 推送通道的**统一传输骨架**（服务进程内）。
 *
 * ## 它统一了什么
 *
 * 「进行中的请求」与「实时指标」是两条数据流，但把它们送给客户端的**传输**是同一件事：
 * 一个长活的 HTTP 响应、一组订阅者、一次背压判断、一个合流节拍、一条心跳。此前这套逻辑
 * 在 `live-request-stream.ts` 与 `live-metrics-stream.ts` 里各写了一遍——连注释都在讲同一
 * 件事。两份实现意味着任何一个传输层面的修正（背压、摘人、定时器回收）都要记得改两处，
 * 而**忘掉一处不会报错**，只会让两条流悄悄漂移。
 *
 * 所以这里只留一份：{@link createFanout} 造一个通道，调用方描述四件事——
 *
 * 1. `snapshot()`：此刻要推的**全量**负载（一帧的业务内容）；
 * 2. `frameOf(payload)`：把负载封成一行版本化消息的字节；
 * 3. `heartbeatFrame`：一条不携带状态的心跳帧的字节（各流按自己的协议版本生成）；
 * 4. `subscribe(onChange)`：在**数据源**变化时回调 `onChange`（不传就是固定数据，只发心跳）。
 *
 * ## 为什么是「一源多订阅者」而不是「一订阅者一源」
 *
 * 通道级只订阅一次数据源，再广播给所有订阅者。若让每个订阅者各自订阅，同一个「台账变了」
 * 就会被处理 N 次、序列化 N 份字节——而所有客户端要的本来就是**同一帧**。这里序列化一次，
 * 多个订阅者共用同一份字符串（见 `writeFrame`）。
 *
 * ## 全量快照、不做增量
 *
 * 两条流都坚持每条快照都是完整状态：实时台账只有进行中和刚结束的一小段，重发完整状态的
 * 代价有界，却天然解决乱序、丢帧、慢客户端与重连对齐。增量要同时补齐每订阅者序号、缺口
 * 检测、重放窗口与快照回退；在没有真正需要之前，不做半套增量。
 *
 * ## 背压：只保留最新一帧
 *
 * 被背压挡住的人这一轮跳过，等 `drain` 再补。补的时候补的是**最新**的负载，而不是排队
 * 一串过期帧——这份数据只有「此刻」有意义，补发一串没人要的旧帧只是浪费内存与带宽。
 *
 * ## 生命周期
 *
 * 没人看时该省的全省：源订阅、合流节拍、心跳定时器都随**最后一个订阅者离开**收掉，且
 * `unref()` 过，不把进程留在事件循环里。通道内部**没有**惰性初始化——调用方（路由模块）
 * 在加载时就 `createFanout` 好，数据源订阅在首个订阅者到来时才发生。
 */

/** 一个推送通道：唯一的对外动作就是把响应挂上来。 */
export interface Fanout {
  /** 挂上一个响应，返回退订函数。首帧同步发出，新客户端不必等一个节拍。 */
  attach(res: ServerResponse): () => void
}

interface Subscriber {
  res: ServerResponse
  /** 上一次写入没被内核缓冲区吃下：这一帧先跳过，等 `drain` 再补。 */
  blocked: boolean
}

interface FanoutDeps<T> {
  /** 此刻的全量负载。 */
  snapshot: () => T
  /** 把负载封成一行版本化消息（含行尾换行）。 */
  frameOf: (payload: T) => string
  /** 不携带状态的心跳帧（含行尾换行），按本流自己的协议版本生成。 */
  heartbeatFrame: string
  /**
   * 订阅数据源的变化。回调**同步**触发，且可能在任意一次写入中——所以这里只把「脏了」记
   * 下来，真正的取快照与推送留给节拍器。返回退订函数。
   */
  subscribe?: (onChange: () => void) => () => void
  /** 一帧的最小间隔（毫秒）；缺省用统一口径。 */
  frameIntervalMilliseconds?: number
  /** 心跳间隔（毫秒）；缺省用统一口径。 */
  heartbeatMilliseconds?: number
}

/**
 * 造一个推送通道。
 *
 * 参数全是函数而不是状态：通道不持有业务数据，只持有订阅者与节拍。因此同一个进程可以并存
 * 任意多条通道（现在就是两条），它们共享这套传输，却各自订阅各自的数据源。
 */
export function createFanout<T>(deps: FanoutDeps<T>): Fanout {
  const frameInterval = deps.frameIntervalMilliseconds ?? STREAM_FRAME_INTERVAL_MILLISECONDS
  const heartbeatInterval = deps.heartbeatMilliseconds ?? STREAM_HEARTBEAT_MILLISECONDS

  const subscribers = new Set<Subscriber>()
  let timer: NodeJS.Timeout | null = null
  let unsubscribeSource: (() => void) | null = null
  /** 数据源自上一帧以来变过没有。 */
  let dirty = false
  let lastFrameAt = 0

  function ensureTimer(): void {
    if (timer !== null) return
    timer = setInterval(tick, frameInterval)
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
    if (dirty) {
      writeFrame(deps.frameOf(deps.snapshot()))
      return
    }
    // 源一直没变时也要发一帧：既当心跳，也让客户端能确认自己还连着。
    if (Date.now() - lastFrameAt >= heartbeatInterval) writeFrame(deps.heartbeatFrame)
  }

  /** 给所有人推同一帧。字节已序列化一次，多个订阅者共用同一份。 */
  function writeFrame(payload: string): void {
    lastFrameAt = Date.now()
    dirty = false
    // 先拷贝一份再遍历：写失败会就地摘人，边遍历边改集合会漏掉后面的订阅者。
    for (const subscriber of [...subscribers]) {
      if (subscriber.blocked) continue
      writeTo(subscriber, payload)
    }
  }

  /** 给单独一个人推一帧（新连上来的那个）。 */
  function writeFrameTo(subscriber: Subscriber): void {
    // 只把这一刻记成「刚推过」，**不能**顺手清掉 `dirty`：`dirty` 的意思是「有人在等这一帧」，
    // 而这一帧只发给了刚连上来的那个人，別的人还没拿到——清了就等于替他们吃掉一次变更，
    // 他们要一直等到下一次心跳（最多 10 秒）才发现数据早就变了。
    lastFrameAt = Date.now()
    writeTo(subscriber, deps.frameOf(deps.snapshot()))
  }

  function writeTo(subscriber: Subscriber, payload: string): void {
    const { res } = subscriber
    if (res.writableEnded || res.destroyed) {
      detach(subscriber)
      return
    }
    if (subscriber.blocked) {
      // 背压下这一帧直接丢掉：数据是「此刻」的，`drain` 时会按最新负载补一帧。
      return
    }
    try {
      subscriber.blocked = !res.write(payload)
    } catch (error) {
      // 对端刚好在这两次判断之间消失时，写一个正在死掉的 socket 不该把服务进程带走。
      console.debug(`[management] live frame dropped: ${(error as Error).message}`)
      detach(subscriber)
    }
  }

  function markDirty(): void {
    dirty = true
  }

  function detach(subscriber: Subscriber): void {
    if (!subscribers.delete(subscriber)) return
    if (subscribers.size > 0) return
    unsubscribeSource?.()
    unsubscribeSource = null
    stopTimer()
  }

  function attach(res: ServerResponse): () => void {
    const subscriber: Subscriber = { res, blocked: false }
    // 从「没人看」变成「有人在看」时才去订阅数据源：没人看的时候连订阅都不该存在。
    if (deps.subscribe !== undefined && subscribers.size === 0) unsubscribeSource = deps.subscribe(markDirty)
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

  return { attach }
}
