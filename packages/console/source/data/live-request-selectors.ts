import type { LiveRequest } from '@common/schemas'
import { liveActivityToneOf, type LiveActivity } from './live-activity'

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
