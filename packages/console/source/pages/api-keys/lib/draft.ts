import type { ApiKeyRow } from '../types'
import { formatLocalDate } from '@/lib/local-date'

/**
 * 对话框草稿与库字段之间的换算。
 *
 * 全是纯函数，住在这里而不是组件里：日期串与时间戳的互转有两条容易搞错的边界——
 * 「选了今天就立刻过期」与「时区偏一天」——它们值得被单测钉住，而组件不参与渲染测试。
 */
export interface ApiKeyDraft {
  name: string
  enabled: boolean
  /** 过期日期（本地日期串，形如 `2026-01-31`）；空串表示永不过期。 */
  expiresDate: string
}

/** 把草稿里的日期串转成毫秒时间戳：取当天**结束**时刻，避免「选了今天就立刻过期」。 */
export function draftExpiresTime(expiresDate: string): number | null {
  if (!expiresDate) return null
  return new Date(`${expiresDate}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 - 1
}

/** 反向：毫秒时间戳 → 日期串。 */
export function toDateInput(expiresTime: number | null): string {
  if (expiresTime === null) return ''
  return formatLocalDate(new Date(expiresTime))
}

export function emptyApiKeyDraft(): ApiKeyDraft {
  return { name: '', enabled: true, expiresDate: '' }
}

export function apiKeyToDraft(key: ApiKeyRow): ApiKeyDraft {
  return { name: key.name, enabled: key.status !== 'expired', expiresDate: toDateInput(key.expiresTime) }
}
