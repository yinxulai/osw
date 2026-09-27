import type { LiveRequestEventLevel } from '@common/schemas'

/** Live 事件的统一视觉语气；具体颜色由消费端的设计令牌决定。 */
export type LiveActivityTone = 'neutral' | 'success' | 'warning' | 'error'

/** 一次 Live 活动；`key` 驱动重挂载，`tone` 驱动状态颜色。 */
export interface LiveActivity {
  key: string
  tone: LiveActivityTone
}

const TONE_BY_LEVEL: Record<LiveRequestEventLevel, LiveActivityTone> = {
  info: 'neutral',
  success: 'success',
  warn: 'warning',
  error: 'error',
}

export function liveActivityToneOf(level: LiveRequestEventLevel): LiveActivityTone {
  return TONE_BY_LEVEL[level]
}
