import { tokensPerSecondFromTotals } from '@common/metrics'
import type { LiveRequest, LiveRequestAttempt, RequestStatus } from '@common/schemas'

/**
 * 「执行中的请求」在界面上的一切取值。
 *
 * 请求列表里只有两种行：**执行中**与**已完成**。前者读的是代理进程内存里的台账
 * （`/api/request-log/live`），后者读的是落库的记录。两种行的字段口径必须能对上，
 * 否则同一条请求在落定的那一瞬间会从一行数字跳成另一行数字。
 *
 * 因此这里的取值规则与落库那条路径逐条对齐：
 *
 * - **尝试级事实取最后一次尝试**，与 `servingAttemptOf` 同义（故障转移一旦交付就停，
 *   被放弃的尝试不会排在它后面）。
 * - **速度走 `@common/metrics` 的同一个公式**，不在界面里就地再算一遍。
 * - **「已经收到多少」只算最后一次尝试**——故障转移期间被放弃的响应一个字节都没交给客户端，
 *   把历次尝试加起来会把客户端从没见过的字节算进去。
 */

/** 一次执行中请求此刻的可读事实。 */
export interface ExecutionSnapshot {
  /** 正在跑（或最后跑过）的那次尝试；一次都没开始时为 `null`。 */
  attempt: LiveRequestAttempt | null
  /** 已开始的尝试次数，含失败后被放弃的那些。 */
  attemptCount: number
  /** 路由选出的候选总数；还没路由时为 0。分母取它而不是已开始的次数，试到第几个才有意义。 */
  candidateCount: number
  /** 请求已经走了多久；已落定时是它的总耗时。 */
  elapsedMilliseconds: number
  ttftMilliseconds: number | null
  inputTokens: number | null
  outputTokens: number | null
  /** 输出速度；不足一次尝试或上游还没报输出时为 `null`。 */
  outputTokensPerSecond: number | null
  /** 客户端此刻已经收下多少响应字节；请求才发出去时是 0。 */
  receivedBytes: number
  /** 上游**最新一个**分块的原文（台账已截断）；还没吐字节时为 `null`。 */
  chunkPreview: string | null
}

/**
 * 这条请求是不是还在执行。
 *
 * 台账说落定了就交给历史详情，但**库里那一行可能还停在 `pending`**：落库与列表轮询
 * 之间有最多 1.5s 的差。这段时间两边说法打架，界面必须挑一个——挑「还没结束」，
 * 因为另一边的代价是把一条刚跑完的请求降级成一张几乎全空的详情卡。
 *
 * `logStatus` 为 `undefined` 表示它还没出现在当前这一页/这一次筛选里，此时只看台账。
 *
 * 写成类型谓词，是为了让调用方在判断成立之后不必再对 `live` 做一次多余的非空断言。
 */
export function isRequestExecuting(live: LiveRequest | undefined, logStatus: RequestStatus | undefined): live is LiveRequest {
  if (live === undefined) return false
  return live.status === 'pending' || logStatus === 'pending'
}

/** 把一份台账快照摊成界面上要用的数字。`now` 由调用方给，便于让「已用时」自己走秒。 */
export function executionSnapshotOf(live: LiveRequest, now: number): ExecutionSnapshot {
  const attempt = live.attempts[live.attempts.length - 1] ?? null
  const attemptDuration = attempt === null ? 0 : (attempt.endedAt ?? now) - attempt.startedAt
  const outputTokens = attempt?.outputTokens ?? null

  return {
    attempt,
    attemptCount: live.attempts.length,
    candidateCount: live.candidates.length,
    elapsedMilliseconds: (live.endedAt ?? now) - live.startedAt,
    ttftMilliseconds: attempt?.ttftMilliseconds ?? null,
    inputTokens: attempt?.inputTokens ?? null,
    outputTokens,
    // 分子与分母同源：都取最后一次尝试。落库那条路径的分母是它的总耗时，
    // 这里对应的是「已经过去了多久」——同一条公式，只是时间还没走完。
    outputTokensPerSecond: outputTokens === null ? null : tokensPerSecondFromTotals(outputTokens, attemptDuration),
    receivedBytes: attempt?.downstreamBytes ?? 0,
    chunkPreview: attempt?.chunkPreview ?? null,
  }
}
