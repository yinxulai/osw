import { beforeEach, describe, expect, it, vi } from 'vitest'

const healthStore = vi.hoisted(() => ({
  getProviderHealth: vi.fn(),
  getProviderModelHealth: vi.fn(),
  recordHealthSuccess: vi.fn(),
  recordProviderModelHealthSuccess: vi.fn(),
  recordProviderModelFailure: vi.fn(),
  recordProviderFailure: vi.fn(),
  listProviderHealth: vi.fn(),
  resetProviderHealth: vi.fn(),
}))

const getSettings = vi.hoisted(() => vi.fn())

vi.mock('../database/health-store', () => healthStore)
vi.mock('../database/settings-store', () => ({ getSettings }))

import {
  getAllHealth,
  isProviderAvailable,
  isProviderModelAvailable,
  markProviderFailure,
  markProviderModelFailure,
  markProviderModelSuccess,
  markProviderSuccess,
  resetHealth,
} from './health'

beforeEach(() => {
  vi.clearAllMocks()
  healthStore.getProviderHealth.mockResolvedValue(null)
  healthStore.getProviderModelHealth.mockResolvedValue(null)
  getSettings.mockResolvedValue({
    consecutiveFailureThreshold: 3,
    cooldownBaseSeconds: 10,
    cooldownMaxSeconds: 300,
  })
})

describe('provider health availability', () => {
  it('allows providers and models without health records or active cooldowns', async () => {
    await expect(isProviderAvailable('provider-1')).resolves.toBe(true)
    await expect(isProviderModelAvailable('model-1')).resolves.toBe(true)

    healthStore.getProviderHealth.mockResolvedValue({ cooldownUntilTime: null })
    healthStore.getProviderModelHealth.mockResolvedValue({ cooldownUntilTime: null })
    await expect(isProviderAvailable('provider-1')).resolves.toBe(true)
    await expect(isProviderModelAvailable('model-1')).resolves.toBe(true)
  })

  it('rejects providers and models while cooldown is active', async () => {
    healthStore.getProviderHealth.mockResolvedValue({ cooldownUntilTime: Date.now() + 60_000 })
    healthStore.getProviderModelHealth.mockResolvedValue({ cooldownUntilTime: Date.now() + 60_000 })

    await expect(isProviderAvailable('provider-1')).resolves.toBe(false)
    await expect(isProviderModelAvailable('model-1')).resolves.toBe(false)
  })

  it('allows providers and models after cooldown expires', async () => {
    healthStore.getProviderHealth.mockResolvedValue({ cooldownUntilTime: Date.now() - 1 })
    healthStore.getProviderModelHealth.mockResolvedValue({ cooldownUntilTime: Date.now() - 1 })

    await expect(isProviderAvailable('provider-1')).resolves.toBe(true)
    await expect(isProviderModelAvailable('model-1')).resolves.toBe(true)
  })
})

describe('health state transitions', () => {
  it('delegates provider and provider-model success and failure with settings', async () => {
    await markProviderSuccess('provider-1')
    await markProviderFailure('provider-1')
    await markProviderModelSuccess('model-1')
    await markProviderModelFailure('model-1')

    expect(healthStore.recordHealthSuccess).toHaveBeenCalledWith('provider-1')
    expect(healthStore.recordProviderFailure).toHaveBeenCalledWith('provider-1', 3, 10, 300)
    expect(healthStore.recordProviderModelHealthSuccess).toHaveBeenCalledWith('model-1')
    expect(healthStore.recordProviderModelFailure).toHaveBeenCalledWith('model-1', 3, 10, 300)
  })

  it('lists and resets provider health', async () => {
    healthStore.listProviderHealth.mockResolvedValue([{ providerId: 'provider-1' }])

    await expect(getAllHealth()).resolves.toEqual([{ providerId: 'provider-1' }])
    await resetHealth('provider-1')
    expect(healthStore.resetProviderHealth).toHaveBeenCalledWith('provider-1')
  })
})
