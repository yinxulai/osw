import type { LiveRequest, RequestStatus } from '@common/schemas'
import { isRequestExecuting } from './execution'

/**
 * 请求落定之后，这一行还要以「实时形态」留在列表里的时长。
 *
 * 为什么需要它：实时形态唯一别处没有的东西，是**这条请求走到了哪一步**——状态格里的那把
 * 五格尺子。它只在请求还没结束时存在，请求一落定就被换成结果本身；而最想读它的时刻，
 * 恰恰是刚跑完、用户回头核对「它死在第几步」的时候。
 *
 * 所以落定后再留一段时间：刻度停住、颜色换成结局的颜色，让人有十秒钟把
 * 「失败在第 3 格，连响应头都没拿到」这件事读进去。
 */
export const LIVE_HOLD_MILLISECONDS = 10_000

/** 这口时钟只为「该收起了没有」而走，一秒精度足够，不必跟着推送的节奏跳。 */
export const LIVE_HOLD_TICK_MILLISECONDS = 1_000

export interface LiveHoldInput {
  /** 台账里那一条；台账已经把它丢掉时为 `undefined`（此时只能显示落库形态）。 */
  live: LiveRequest | undefined
  /** 库里那一行的状态；它不在这一页、或还没落库时为 `undefined`。 */
  logStatus: RequestStatus | undefined
  /** 用户此刻是否正展开这一条。 */
  expanded: boolean
  /** 用户上一次把它收起来的时刻；从未展开过为 `null`。 */
  collapsedAt: number | null
  now: number
}

/**
 * 这一行还能留到什么时候（epoch ms）；`null` 表示**不设期限**。
 *
 * 不设期限只有两种情形，且都是「别去动用户正在看的东西」：
 *
 * - 请求还在跑（`endedAt` 为 `null`）——它本来就该在；
 * - 用户正展开着它——他盯着这一行看，把内容换掉等于从他手里抢走。
 *
 * 其余情况下，锚点取「落定」与「收起」里更晚的那个：请求一落定就收起时两者几乎同时，
 * 多算几十毫秒没有意义；而请求早就落定、用户过一阵才点开又收起时，`collapsedAt`
 * 才是那个该起算的时刻——**收起之后至少再留满一个完整窗口**。
 */
export function liveHoldDeadlineOf(input: LiveHoldInput): number | null {
  if (input.live === undefined) return null
  if (input.live.endedAt === null) return null
  if (input.expanded) return null
  return Math.max(input.live.endedAt, input.collapsedAt ?? input.live.endedAt) + LIVE_HOLD_MILLISECONDS
}

/**
 * 这一行此刻该用实时形态还是落库形态。
 *
 * 前半句与列表原有的口径完全一致（见 `isRequestExecuting`）：台账说还在跑，或者库里那一行
 * 还停在 `pending`，就用实时形态——落库比推送慢最多 1.5s，这段时间里两边说法打架，
 * 界面挑「还没结束」，否则一条刚跑完的请求会先塌成一张几乎全空的详情卡再跳回来。
 *
 * 后半句才是这里新增的：两边都说落定了，再多留一个窗口。
 *
 * 期限**天然不会超过台账的保留期**（`SETTLED_TTL_MILLISECONDS`，60s）：过了那一刻台账里
 * 没有这一条了，`live` 变 `undefined`，这一行自动交回落库形态——没有「一直展开着所以数据
 * 永远不来」的可能。
 */
export function isLiveRowAlive(input: LiveHoldInput): boolean {
  if (input.live === undefined) return false
  if (isRequestExecuting(input.live, input.logStatus)) return true
  const deadline = liveHoldDeadlineOf(input)
  return deadline === null || input.now < deadline
}
