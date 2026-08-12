import {
  getProviderHealth,
  recordHealthSuccess,
  recordHealthFailure,
  listProviderHealth,
  resetProviderHealth,
  getSettings,
} from '../database/store'

export async function isProviderAvailable(providerId: string): Promise<boolean> {
  const health = await getProviderHealth(providerId)
  if (!health) return true
  if (health.cooldownUntilTime === null) return true
  return Date.now() >= health.cooldownUntilTime
}

export async function markProviderSuccess(providerId: string): Promise<void> {
  await recordHealthSuccess(providerId)
}

export async function markProviderFailure(providerId: string): Promise<void> {
  const settings = await getSettings()
  const health = await getProviderHealth(providerId)
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

  await recordHealthFailure(providerId, cooldownUntilTime)
}

export async function getAllHealth() {
  return listProviderHealth()
}

export async function resetHealth(providerId: string): Promise<void> {
  await resetProviderHealth(providerId)
}
