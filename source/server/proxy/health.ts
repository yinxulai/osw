import {
  getProviderHealth,
  recordHealthSuccess,
  recordHealthFailure,
  listProviderHealth,
  resetProviderHealth,
  getSettings,
} from '../database/store'

export function isProviderAvailable(providerId: string): boolean {
  const health = getProviderHealth(providerId)
  if (!health) return true
  if (health.cooldownUntilTime === null) return true
  return Date.now() >= health.cooldownUntilTime
}

export function markProviderSuccess(providerId: string): void {
  recordHealthSuccess(providerId)
}

export function markProviderFailure(providerId: string): void {
  const settings = getSettings()
  const health = getProviderHealth(providerId)
  const consecutiveFailures = (health?.consecutiveFailures ?? 0) + 1

  let cooldownUntilTime: number | null = null
  if (consecutiveFailures >= settings.consecutiveFailureThreshold) {
    const exponent = consecutiveFailures - settings.consecutiveFailureThreshold
    const seconds = Math.min(
      settings.cooldownBaseSeconds * Math.pow(2, exponent),
      settings.cooldownMaxSeconds,
    )
    cooldownUntilTime = Date.now() + seconds * 1000
  }

  recordHealthFailure(providerId, cooldownUntilTime)
}

export function getAllHealth() {
  return listProviderHealth()
}

export function resetHealth(providerId: string): void {
  resetProviderHealth(providerId)
}
