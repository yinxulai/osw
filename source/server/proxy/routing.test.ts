import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Provider, ProviderModelRoute } from '@common/schemas'

const mocks = vi.hoisted(() => ({
  models: [] as Array<{ model: ProviderModelRoute; provider: Provider }>,
  manualModel: null as string | null,
}))

vi.mock('./router', () => ({
  getAvailableModels: async () => mocks.models,
  findEndpoint: (model: ProviderModelRoute, protocol: string) => model.endpoints.find(endpoint => endpoint.protocol === protocol),
  findConvertibleEndpoint: (model: ProviderModelRoute, protocol: string) => model.endpoints.find(endpoint => endpoint.protocolConversionEnabled && endpoint.protocol !== protocol),
}))
vi.mock('./manual-routing', () => ({
  getManualModel: () => mocks.manualModel,
}))

import { resolveAttemptSnapshot, resolveProxyTargets } from './routing'

const provider: Provider = {
  id: 'prov_1', name: 'Provider', apiKeyReference: 'key', timeoutMilliseconds: 1000,
  enabled: true, createdTime: 0, updatedTime: 0, deletedTime: null,
}
function model(id: string, protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages' = 'openai-completions', conversion = false): ProviderModelRoute {
  return { id, providerId: provider.id, modelName: `upstream-${id}`, endpoints: [{ protocol, endpointUrl: `https://${id}.example`, customAuthHeader: null, protocolConversionEnabled: conversion }], priority: 1, enabled: true, createdTime: 0, updatedTime: 0, deletedTime: null }
}

afterEach(() => { mocks.models = []; mocks.manualModel = null })

describe('resolveProxyTargets', () => {
  it('filters unsupported models and preserves queue order', async () => {
    mocks.models = [{ model: model('a'), provider }, { model: model('b', 'anthropic-messages'), provider }]
    const result = await resolveProxyTargets('logical', 'openai-completions')
    expect(result.targets.map(target => target.model.id)).toEqual(['a'])
    expect(result.manualModelUnavailable).toBe(false)
  })

  it('starts at the manually selected model without silently falling back', async () => {
    mocks.models = [{ model: model('a'), provider }, { model: model('b'), provider }, { model: model('c'), provider }]
    mocks.manualModel = 'b'
    const result = await resolveProxyTargets('logical', 'openai-completions')
    expect(result.targets.map(target => target.model.id)).toEqual(['b', 'c'])
  })

  it('rejects an unavailable manual model', async () => {
    mocks.models = [{ model: model('a'), provider }]
    mocks.manualModel = 'missing'
    await expect(resolveProxyTargets('logical', 'openai-completions')).resolves.toMatchObject({ targets: [], manualModelUnavailable: true })
  })
})

describe('resolveAttemptSnapshot', () => {
  it('prefers a native endpoint and falls back to conversion', () => {
    const native = model('native')
    expect(resolveAttemptSnapshot({ model: native, provider }, 'openai-completions')).toMatchObject({ upstreamProtocol: 'openai-completions', url: 'https://native.example' })

    const converted = model('converted', 'openai-completions', true)
    expect(resolveAttemptSnapshot({ model: converted, provider }, 'anthropic-messages')).toMatchObject({ upstreamProtocol: 'openai-completions', url: 'https://converted.example' })
  })

  it('throws when no endpoint can serve the protocol', () => {
    expect(() => resolveAttemptSnapshot({ model: model('unsupported', 'openai-responses'), provider }, 'anthropic-messages')).toThrow('does not support protocol')
  })
})
