import {
  getProviderHealth,
  recordHealthSuccess,
  recordHealthFailure,
  listProviderHealth,
  resetProviderHealth,
} from './db/store'
import { getSettings } from './db/store'

/**
 * 检查 Provider 是否可用（不在冷却中）
 */
export function isProviderAvailable(providerId: string): boolean {
  const health = getProviderHealth(providerId)
  if (!health) return true
  if (health.cooldownUntilTime === null) return true
  return Date.now() >= health.cooldownUntilTime
}

/**
 * 记录一次成功请求，重置连续失败计数和冷却
 */
export function markProviderSuccess(providerId: string): void {
  recordHealthSuccess(providerId)
}

/**
 * 记录一次失败请求，递增连续失败计数，达到阈值则进入冷却
 */
export function markProviderFailure(providerId: string): void {
  const settings = getSettings()
  const health = getProviderHealth(providerId)
  const consecutiveFailures = (health?.consecutiveFailures ?? 0) + 1

  let cooldownUntilTime: number | null = null
  if (consecutiveFailures >= settings.consecutiveFailureThreshold) {
    // 指数退避：base * 2^(failures - threshold)，不超过 max
    const exponent = consecutiveFailures - settings.consecutiveFailureThreshold
    const seconds = Math.min(
      settings.cooldownBaseSeconds * Math.pow(2, exponent),
      settings.cooldownMaxSeconds,
    )
    cooldownUntilTime = Date.now() + seconds * 1000
  }

  recordHealthFailure(providerId, cooldownUntilTime)
}

/**
 * 获取所有 Provider 健康状态
 */
export function getAllHealth() {
  return listProviderHealth()
}

/**
 * 重置某个 Provider 的健康状态
 */
export function resetHealth(providerId: string): void {
  resetProviderHealth(providerId)
}
