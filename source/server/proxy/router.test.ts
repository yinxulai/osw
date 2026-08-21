import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectProtocolFromPath, findConvertibleEndpoint, findEndpoint, getAvailableModels } from './router'
import type { Provider, ProviderModelRoute } from '@common/schemas'

const mocks = vi.hoisted(() => ({
  models: [] as ProviderModelRoute[],
  provider: undefined as Provider | undefined,
  unavailableModels: new Set<string>(),
}))

vi.mock('../database/store', () => ({
  listProviderModelsForLogicalModel: async () => mocks.models,
  getProvider: async () => mocks.provider,
}))

vi.mock('./health', () => ({
  isProviderAvailable: async () => true,
  isProviderModelAvailable: async (providerModelId: string) => !mocks.unavailableModels.has(providerModelId),
}))

afterEach(() => {
  mocks.models = []
  mocks.provider = undefined
  mocks.unavailableModels.clear()
})

describe('getAvailableModels', () => {
  it('skips only the cooled provider model while preserving siblings from the same provider', async () => {
    const time = Date.now()
    mocks.provider = {
      id: 'prov_shared',
      name: 'Shared Provider',
      apiKeyReference: 'shared-key',
      timeoutMilliseconds: 1_000,
      enabled: true,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    }
    mocks.models = [
      { id: 'model_cooled', providerId: 'prov_shared', modelName: 'cooled', endpoints: [], priority: 1, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_ready', providerId: 'prov_shared', modelName: 'ready', endpoints: [], priority: 2, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
    ]
    mocks.unavailableModels.add('model_cooled')

    const available = await getAvailableModels('auto')

    expect(available.map(entry => entry.model.id)).toEqual(['model_ready'])
  })
})

describe('findEndpoint', () => {
  const model: ProviderModelRoute = {
    id: 'model_1',
    providerId: 'prov_1',
    modelName: 'upstream-1',
    endpoints: [
      { protocol: 'openai-completions', upstreamUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: false },
      { protocol: 'anthropic-messages', upstreamUrl: 'https://b.example.com', customAuthHeader: 'Bearer x', protocolConversionEnabled: false },
    ],
    priority: 1,
    enabled: true,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  }

  it('returns the endpoint matching the requested protocol', () => {
    expect(findEndpoint(model, 'openai-completions')?.protocol).toBe('openai-completions')
    expect(findEndpoint(model, 'anthropic-messages')?.customAuthHeader).toBe('Bearer x')
  })

  it('returns undefined when the protocol is not configured', () => {
    expect(findEndpoint(model, 'openai-responses')).toBeUndefined()
  })
})

describe('findConvertibleEndpoint', () => {
  const base: ProviderModelRoute = {
    id: 'model_1',
    providerId: 'prov_1',
    modelName: 'upstream-1',
    endpoints: [],
    priority: 1,
    enabled: true,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
  }

  it('returns the conversion-enabled endpoint for a convertible client protocol', () => {
    const model: ProviderModelRoute = {
      ...base,
      endpoints: [
        { protocol: 'openai-completions', upstreamUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: true },
      ],
    }
    expect(findConvertibleEndpoint(model, 'anthropic-messages')?.protocol).toBe('openai-completions')
    expect(findConvertibleEndpoint(model, 'openai-responses')?.protocol).toBe('openai-completions')
  })

  it('ignores endpoints without protocolConversionEnabled', () => {
    const model: ProviderModelRoute = {
      ...base,
      endpoints: [
        { protocol: 'openai-completions', upstreamUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: false },
      ],
    }
    expect(findConvertibleEndpoint(model, 'anthropic-messages')).toBeUndefined()
  })

  it('ignores endpoints whose protocol cannot serve the client protocol', () => {
    const model: ProviderModelRoute = {
      ...base,
      endpoints: [
        { protocol: 'openai-responses', upstreamUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: true },
      ],
    }
    expect(findConvertibleEndpoint(model, 'anthropic-messages')).toBeUndefined()
    expect(findConvertibleEndpoint(model, 'openai-completions')).toBeUndefined()
  })

  it('does not match an endpoint serving its own protocol', () => {
    const model: ProviderModelRoute = {
      ...base,
      endpoints: [
        { protocol: 'openai-completions', upstreamUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: true },
      ],
    }
    expect(findConvertibleEndpoint(model, 'openai-completions')).toBeUndefined()
  })
})

describe('detectProtocolFromPath', () => {
  it.each([
    ['/v1/chat/completions', 'openai-completions'],
    ['/chat/completions', 'openai-completions'],
    ['/v1/completions', 'openai-completions'],
    ['/completions/', 'openai-completions'],
    ['/v1/embeddings', 'openai-completions'],
    ['/embeddings?encoding_format=float', 'openai-completions'],
    ['/v1/responses?stream=true', 'openai-responses'],
    ['/responses/', 'openai-responses'],
    ['/v1/messages?beta=true', 'anthropic-messages'],
    ['/messages/', 'anthropic-messages'],
  ] as const)('detects %s as %s', (path, expected) => {
    expect(detectProtocolFromPath(path)).toBe(expected)
  })

  it.each([
    '/v1/models',
    '/models',
    '/v1/completions/extra',
    '/v1beta/models/gemini-2.5-pro:generateContent',
    '/v1/unknown',
    '/health',
    '/',
  ])('does not claim unsupported path %s', path => {
    expect(detectProtocolFromPath(path)).toBeNull()
  })
})
