import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveRequest, RequestStatus } from '@common/schemas'
import { LIVE_HOLD_TICK_MILLISECONDS, isLiveRowAlive } from '../lib/live-hold'

/**
 * 「这一行还该不该用实时形态」——带上了落定后的保留窗口。
 *
 * 三件事必须由这一层记住，行组件自己记不住：
 *
 * 1. **台账里还有没有它**。行组件只在拿得到 `live` 时才会被渲染，所以「台账把它丢掉了吗」
 *    只有列表这一层看得见。
 * 2. **用户什么时候把它收起来的**。收起的时刻不在任何一行上，它跨行、也跨渲染。
 * 3. **现在几点**。保留窗口是按墙上的钟算的，与推送无关：请求落定之后可能再也没有任何一条
 *    推送提到它，不自己走秒的话，那一行会一直停在屏幕上。
 *
 * 第 3 条只在**有已落定的请求还在台账里**时才走：全都在跑时用不上它（那时 `endedAt` 为
 * `null`，本来就不设期限），没有请求时更不该白白每秒重渲染一次整张表。
 */
export function useLiveRowHold(liveRequests: LiveRequest[], expandedId: string | null) {
  /** `id → 收起时刻`。只为「收起来之后至少还要留满一个窗口」这一个用途存在。 */
  const [collapsedAt, setCollapsedAt] = useState<Record<string, number>>({})
  const [now, setNow] = useState(() => Date.now())
  const previousExpanded = useRef<string | null>(expandedId)

  useEffect(() => {
    const previous = previousExpanded.current
    previousExpanded.current = expandedId
    // 只在「从展开某一条」变成「不再展开它」时记账。展开是用户主动要看，收起才是那句话
    // 的起点；顺着这个 key 一路点开又收起，起点自然被刷新到最近一次。
    if (previous === null || previous === expandedId) return
    setCollapsedAt(current => ({ ...current, [previous]: Date.now() }))
  }, [expandedId])

  const holding = liveRequests.some(request => request.endedAt !== null)

  useEffect(() => {
    if (!holding) return
    const timer = window.setInterval(() => setNow(Date.now()), LIVE_HOLD_TICK_MILLISECONDS)
    return () => window.clearInterval(timer)
  }, [holding])

  return useCallback((live: LiveRequest | undefined, logStatus: RequestStatus | undefined) => isLiveRowAlive({
    live,
    logStatus,
    expanded: live !== undefined && expandedId === live.id,
    collapsedAt: live === undefined ? null : collapsedAt[live.id] ?? null,
    now,
  }), [collapsedAt, expandedId, now])
}
