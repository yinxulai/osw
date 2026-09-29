import { describe, expect, it } from 'vitest'
import type { LiveRequest, LiveRequestAttempt, LiveRequestAttemptState, ProviderHealth, ProviderModelHealth } from './schemas'
import {
  isProviderModelCooling,
  providerModelProcessingCounts,
  resolveProviderModelBadge,
} from './provider-model-status'

function request(overrides: Partial<LiveRequest> = {}): LiveRequest {
  return {
    id: 'req_test',
    status: 'pending',
    phase: 'streaming',
    logicalModelId: 'logical_primary',
    clientProtocol: 'openai-responses',
    transport: 'http',
    method: 'POST',
    path: '/v1/responses',
    startedAt: 1,
    updatedAt: 1,
    endedAt: null,
    candidates: [],
    attempts: [],
    events: [],
    ...overrides,
  }
}

function attempt(providerModelId: string, state: LiveRequestAttemptState): LiveRequestAttempt {
  return {
    index: 0,
    providerId: 'prov_1',
    providerName: 'Provider',
    providerModelId,
    providerModelName: providerModelId,
    endpointProtocol: 'openai-responses',
    url: 'https://example.com/v1',
    state,
    httpStatus: null,
    upstreamTransport: null,
    requestBytes: 0,
    requestRewriteRuleNames: [],
    upstreamBytes: 0,
    downstreamBytes: 0,
    chunkCount: 0,
    chunkPreview: null,
    ttftMilliseconds: null,
    inputTokens: null,
    outputTokens: null,
    errorMessage: null,
    startedAt: 1,
    endedAt: null,
  }
}

describe('providerModelProcessingCounts', () => {
  it('counts in-flight requests per provider model', () => {
    const counts = providerModelProcessingCounts([
      request({ id: 'req_one', attempts: [attempt('pm_a', 'streaming')] }),
      request({ id: 'req_two', attempts: [attempt('pm_a', 'awaiting-upstream')] }),
      request({ id: 'req_three', attempts: [attempt('pm_b', 'connecting')] }),
    ])

    expect(counts.get('pm_a')).toBe(2)
    expect(counts.get('pm_b')).toBe(1)
  })

  it('counts a request against its latest attempt after a failover', () => {
    const counts = providerModelProcessingCounts([
      request({ attempts: [attempt('pm_old', 'failed'), attempt('pm_new', 'streaming')] }),
    ])

    expect(counts.get('pm_old')).toBeUndefined()
    expect(counts.get('pm_new')).toBe(1)
  })

  it('ignores settled requests, ended attempts, and requests still routing', () => {
    const counts = providerModelProcessingCounts([
      request({ id: 'req_success', status: 'success', phase: 'settled', attempts: [attempt('pm_a', 'success')] }),
      request({ id: 'req_ended', attempts: [attempt('pm_a', 'success')] }),
      request({ id: 'req_routing', logicalModelId: null, attempts: [] }),
    ])

    expect(counts.size).toBe(0)
  })

  it('returns an empty map before the first snapshot arrives', () => {
    expect(providerModelProcessingCounts(undefined).size).toBe(0)
  })
})

describe('isProviderModelCooling', () => {
  const now = 1_000

  function provider(cooldownUntilTime: number | null): ProviderHealth {
    return {
      providerId: 'prov_1',
      consecutiveFailures: 0,
      cooldownUntilTime,
      lastSuccessTime: null,
      lastFailureTime: null,
      updatedTime: now,
    }
  }

  function providerModel(cooldownUntilTime: number | null): ProviderModelHealth {
    return {
      providerModelId: 'pm_1',
      consecutiveFailures: 0,
      cooldownUntilTime,
      lastSuccessTime: null,
      lastFailureTime: null,
      updatedTime: now,
    }
  }

  it('is cooling while either the provider or the model is still in cooldown', () => {
    expect(isProviderModelCooling(provider(now + 1), undefined, now)).toBe(true)
    expect(isProviderModelCooling(undefined, providerModel(now + 1), now)).toBe(true)
  })

  it('is not cooling once both cooldowns have expired', () => {
    expect(isProviderModelCooling(provider(now), providerModel(now - 1), now)).toBe(false)
  })

  it('is not cooling without any health signal', () => {
    expect(isProviderModelCooling(undefined, undefined, now)).toBe(false)
  })
})

describe('resolveProviderModelBadge', () => {
  const standby = { processingCount: 0, modelEnabled: true, enabled: true, cooling: false }

  it('reports in-flight requests with their count', () => {
    expect(resolveProviderModelBadge({ ...standby, processingCount: 3 })).toEqual({
      tone: 'info',
      key: 'logicalModels.row.processing',
      count: 3,
    })
  })

  it('lets in-flight requests win over every configuration state', () => {
    const badge = resolveProviderModelBadge({
      processingCount: 1,
      modelEnabled: false,
      enabled: false,
      cooling: true,
      selected: false,
    })

    expect(badge.key).toBe('logicalModels.row.processing')
  })

  it('ranks a disabled model above cooling and a disabled binding', () => {
    expect(resolveProviderModelBadge({ ...standby, modelEnabled: false, enabled: false, cooling: true }).key)
      .toBe('logicalModels.row.modelDisabled')
  })

  it('ranks cooling above a disabled binding', () => {
    expect(resolveProviderModelBadge({ ...standby, enabled: false, cooling: true }).key)
      .toBe('logicalModels.row.cooling')
  })

  it('falls back to a disabled binding when nothing else applies', () => {
    expect(resolveProviderModelBadge({ ...standby, enabled: false })).toEqual({
      tone: 'muted',
      key: 'common.state.disabled',
    })
  })

  it('distinguishes the manual selection from standby', () => {
    expect(resolveProviderModelBadge({ ...standby, selected: true }).key).toBe('logicalModels.row.selected')
    expect(resolveProviderModelBadge(standby).key).toBe('logicalModels.row.standby')
  })
})
