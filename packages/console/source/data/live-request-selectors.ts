import type { LiveRequest } from '@common/schemas'
import { liveActivityToneOf, type LiveActivity } from './live-activity'

interface LiveActivityEntry {
  activity: LiveActivity
  at: number
}

function activityEntryOf(request: LiveRequest): LiveActivityEntry | null {
  if (request.status !== 'pending') return null

  const event = request.events.at(-1)
  if (!event) {
    return {
      activity: {
        key: `${request.id}:start:${request.startedAt}`,
        tone: 'neutral',
      },
      at: request.startedAt,
    }
  }

  return {
    activity: {
      key: `${request.id}:${request.events.length}:${event.at}:${event.kind}`,
      tone: liveActivityToneOf(event.level),
    },
    at: event.at,
  }
}

/**
 * 取出请求此刻应播放的活动；请求结束后返回 `null`。
 *
 * 动画只该跟着真实事件走，不该跟着字节计数走。流式请求每 150 毫秒都可能刷新
 * `upstreamBytes` / `chunkPreview`，如果拿 `updatedAt` 当信号，边框会从头到尾一直闪；
 * 而 `events` 只在路由、准备、响应头、首字节、故障转移和收尾这些有意义的节点追加。
 */
export function liveRequestActivity(request: LiveRequest): LiveActivity | null {
  return activityEntryOf(request)?.activity ?? null
}

/**
 * 每个忙碌逻辑模型当前应播放的活动；键变化即代表有新事件，动画由消费者按键重新挂载。
 *
 * Map 里存在某个 id 就表示它仍在处理请求。已结束的请求即使还在 60 秒保留期内也不会出现。
 * 同一模型并发多个请求时取事件时间最新的那一个，因此每次新事件都会推着同一张卡片往前走。
 */
export function logicalModelActivities(requests: LiveRequest[] | undefined): Map<string, LiveActivity> {
  const latest = new Map<string, LiveActivityEntry>()
  for (const request of requests ?? []) {
    if (request.logicalModelId === null) continue

    const entry = activityEntryOf(request)
    if (entry === null) continue
    const current = latest.get(request.logicalModelId)
    if (current && current.at > entry.at) continue
    latest.set(request.logicalModelId, entry)
  }

  return new Map([...latest].map(([logicalModelId, entry]) => [logicalModelId, entry.activity]))
}
