import { describe, expect, it } from 'vitest'
import type { ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { resolveQueueModelHealthDisplay } from './queue-model-row'

function providerHealth(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return {
    providerId: 'prov_1',
    consecutiveFailures: 0,
    cooldownUntilTime: null,
    lastSuccessTime: null,
    lastFailureTime: null,
    updatedTime: 1,
    ...overrides,
  }
}

function providerModelHealth(overrides: Partial<ProviderModelHealth> = {}): ProviderModelHealth {
  return {
    providerModelId: 'model_1',
    consecutiveFailures: 0,
    cooldownUntilTime: null,
    lastSuccessTime: null,
    lastFailureTime: null,
    updatedTime: 1,
    ...overrides,
  }
}

describe('resolveQueueModelHealthDisplay', () => {
  it('prefers model-level health when model has any health signal', () => {
    const result = resolveQueueModelHealthDisplay({
      providerModelHealth: providerModelHealth({ lastSuccessTime: 2_000 }),
      providerHealth: providerHealth({ lastSuccessTime: 1_000 }),
    })

    expect(result).toEqual({
      source: 'model',
      consecutiveFailures: 0,
      lastSuccessTime: 2_000,
    })
  })

  it('falls back to provider health when model has no health signal', () => {
    const result = resolveQueueModelHealthDisplay({
      providerModelHealth: providerModelHealth(),
      providerHealth: providerHealth({ lastSuccessTime: 3_000 }),
    })

    expect(result).toEqual({
      source: 'provider-fallback',
      consecutiveFailures: 0,
      lastSuccessTime: 3_000,
    })
  })

  it('returns none when both model and provider have no health signal', () => {
    const result = resolveQueueModelHealthDisplay({
      providerModelHealth: providerModelHealth(),
      providerHealth: providerHealth(),
    })

    expect(result).toEqual({
      source: 'none',
      consecutiveFailures: 0,
      lastSuccessTime: null,
    })
  })
})
