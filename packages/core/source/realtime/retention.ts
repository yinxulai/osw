/**
 * 实时内存数据的**唯一保留口径**。
 *
 * 「进行中的请求」与「实时指标」跑在同一块内存上，它们的保留上限此前各写各的：台账里一组
 * 常量、两条推送通道里又各一组间隔。分散的代价不是重复几个数字，而是**这块内存不再有单一
 * 的事实来源**——改一处忘一处之后，没人再能一眼回答「它最多占多少」。而实时数据是**没有
 * 落库兜底**的：一旦失控，只能靠重启回收。
 *
 * 所以所有上限集中在这里，命名按「保留什么」而不是「谁在用」：改这一处，台账与推送通道的
 * 裁剪同时改变。需要这些数字的模块只 import 常量，不再各自 `const` 一遍。
 *
 * 这几个数都不是性能参数，是**可读性参数**：
 *
 * - **条数**按「界面一次能看多少」定——多出来的既没人看见，也没有统计意义；
 * - **时长**按「离开视线后还要留多久」定——只为让「刚结束」不凭空消失；
 * - **间隔**按「人眼能忍受多慢」定——够快让状态跟上，又不至于每秒把界面叫醒十几次。
 */

/** 单条请求保留的事件条数；超出丢最旧。 */
export const MAX_EVENTS_PER_REQUEST = 200

/** 单次尝试保留的分块预览字符数（只留最新一块）。 */
export const MAX_CHUNK_PREVIEW_CHARACTERS = 240

/** 已落定请求在内存里保留的条数。 */
export const MAX_SETTLED_REQUESTS = 50

/** 已落定请求在内存里保留的时长（毫秒）。 */
export const SETTLED_TTL_MILLISECONDS = 60_000

/** 推送通道的每帧最小间隔（毫秒）：源连变时也最多这么快出一帧。 */
export const STREAM_FRAME_INTERVAL_MILLISECONDS = 150

/** 推送通道的心跳间隔（毫秒）：长期无变化时也发一帧证明连接还活着。 */
export const STREAM_HEARTBEAT_MILLISECONDS = 10_000

/** 实时指标的合流窗口（毫秒）：指标变化后最多攒这么久再算一帧。 */
export const LIVE_METRICS_COALESCE_MILLISECONDS = 200

/**
 * 实时指标的心跳间隔（毫秒）。
 *
 * 比其他通道短，因为速度是个**时间量**：没有新 Token 到达时台账不变，但 TPS 该随时间流逝
 * 自然回落，需要一个更密的出口把这份回落推出去。
 */
export const LIVE_METRICS_HEARTBEAT_MILLISECONDS = 1_000

/** {@link pruneNewestFirst} 的裁剪参数。 */
export interface PruneOptions<T> {
  /** 取「这条记录的最新时刻」；列表必须按它**倒序**（新→旧）排列。 */
  newestAt: (item: T) => number
  /** 保留的条数上限。 */
  max: number
  /** 保留的时长上限（毫秒）。 */
  ttlMilliseconds: number
  /** 当前时刻；过期判据是它减去时长。 */
  now: number
}

/**
 * 就地裁掉过期与超量的记录，返回同一个数组。
 *
 * 输入必须按「新→旧」排列，因此遇到第一个过期项就能停——**不必逐个 filter**，也不用真拿
 * 时间戳去比每一条。两个上限一起执行：先按时长砍掉尾巴，再按条数截断；条数上限总是更紧的
 * 那一个（界面能看的行数远少于保留时长扛得住的量），所以顺序无关紧要，但先砍尾巴让下面的
 * 截断永远只作用于新鲜数据。
 */
export function pruneNewestFirst<T>(items: T[], options: PruneOptions<T>): T[] {
  const deadline = options.now - options.ttlMilliseconds
  let keep = items.length
  for (let index = 0; index < items.length; index += 1) {
    if (options.newestAt(items[index]) < deadline) {
      keep = index
      break
    }
  }
  if (keep > options.max) keep = options.max
  if (keep < items.length) items.length = keep
  return items
}
