import type { ApiKey } from '@common/schemas'

/** 界面用的状态：由 `enabled` 与 `expiresTime` 在当前时刻推导，不落库。 */
export type ApiKeyStatus = 'enabled' | 'disabled' | 'expired'

/**
 * 列表行的展示模型。
 *
 * 时间敏感字段（是否过期）在渲染时按 `now` 求值，而不是在数据层算一次缓存起来：
 * 页面放着不动一整天，过期的那把 Key 也得自己变灰，而不等用户手动刷新。
 */
export interface ApiKeyRow extends ApiKey {
  status: ApiKeyStatus
  /** 最近一次被使用的时间；`null` 表示这把 Key 签发后一次都没被用过。 */
  lastUsedTime: number | null
  /** 最近 {@link API_KEY_RECENT_WINDOW_DAYS} 天内的请求数。没用过就是 0，不是空。 */
  recentRequests: number
}

export function resolveApiKeyStatus(key: ApiKey, now: number): ApiKeyStatus {
  if (key.expiresTime !== null && key.expiresTime <= now) return 'expired'
  return key.enabled ? 'enabled' : 'disabled'
}
