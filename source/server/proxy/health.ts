import {
  getProviderHealth,
  recordHealthSuccess,
  recordProviderFailure,
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
  await recordProviderFailure(
    providerId,
    settings.consecutiveFailureThreshold,
    settings.cooldownBaseSeconds,
    settings.cooldownMaxSeconds,
  )
}

export async function getAllHealth() {
  return listProviderHealth()
}

export async function resetHealth(providerId: string): Promise<void> {
  await resetProviderHealth(providerId)
}
