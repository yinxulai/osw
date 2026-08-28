import {
  getProviderHealth,
  getProviderModelHealth,
  recordHealthSuccess,
  recordProviderModelHealthSuccess,
  recordProviderModelFailure,
  recordProviderFailure,
  listProviderHealth,
  resetProviderHealth,
} from '@server/database/health-store'
import { getSettings } from '@server/database/settings-store'

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

export async function isProviderModelAvailable(providerModelId: string): Promise<boolean> {
  const health = await getProviderModelHealth(providerModelId)
  if (!health) return true
  if (health.cooldownUntilTime === null) return true
  return Date.now() >= health.cooldownUntilTime
}

export async function markProviderModelSuccess(providerModelId: string): Promise<void> {
  await recordProviderModelHealthSuccess(providerModelId)
}

export async function markProviderModelFailure(providerModelId: string): Promise<void> {
  const settings = await getSettings()
  await recordProviderModelFailure(
    providerModelId,
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
