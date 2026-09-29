import type { LiveRequest, LiveRequestAttemptState } from '@common/schemas'
import { liveActivityToneOf, type LiveActivity } from './live-activity'

/** 尝试仍在推进的状态；落到其他状态后，请求不再算作「该模型正在处理」。 */
const ACTIVE_ATTEMPT_STATES: ReadonlySet<LiveRequestAttemptState> = new Set(['connecting', 'awaiting-upstream', 'streaming'])

function requestActivityOf(request: LiveRequest): LiveActivity | null {
  if (request.status !== 'pending') return null

  const event = request.events.at(-1)
  if (!event) {
    return {
      key: `${request.id}:start:${request.startedAt}`,
      tone: 'neutral',
    }
  }

  return {
    key: `${request.id}:${request.events.length}:${event.at}:${event.kind}`,
    tone: liveActivityToneOf(event.level),
  }
}

/**
 * 取出请求此刻应播放的活动；请求结束后返回 `null`。
 *
 * 活动只该跟着真实事件走，不该跟着字节计数走。流式请求每 150 毫秒都可能刷新
 * `upstreamBytes` / `chunkPreview`，如果拿 `updatedAt` 当信号，状态圆点会从头到尾一直闪；
 * 而 `events` 只在路由、准备、响应头、首字节、故障转移和收尾这些有意义的节点追加。
 */
export function liveRequestActivity(request: LiveRequest): LiveActivity | null {
  return requestActivityOf(request)
}

/**
 * 每个正在处理请求的供应商模型此刻的在途请求数；键是供应商模型 id（`providerModelId`）。
 *
 * 一次请求只算在**最近一次尝试**落到的模型头上：故障转移之后旧模型立刻出局，
 * 「谁在干活」始终是列表里那一行，而不是整条候选链。请求还没开始尝试（仍在路由）、
 * 或这次尝试已经收尾时，谁都不算。
 */
export function providerModelProcessingCounts(requests: LiveRequest[] | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const request of requests ?? []) {
    if (request.status !== 'pending') continue

    const attempt = request.attempts.at(-1)
    if (!attempt || !ACTIVE_ATTEMPT_STATES.has(attempt.state)) continue
    counts.set(attempt.providerModelId, (counts.get(attempt.providerModelId) ?? 0) + 1)
  }

  return counts
}
