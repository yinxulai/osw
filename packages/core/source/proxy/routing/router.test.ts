import { afterEach, describe, expect, it, vi } from 'vitest'
import { findConvertibleEndpoint, findEndpoint, getAvailableModels, getAvailableModelsBatch } from '@server/proxy/routing/router'
import type { Provider, ProviderModelRoute } from '@common/schemas'

const mocks = vi.hoisted(() => ({
  models: [] as ProviderModelRoute[],
  modelsByLogicalModel: new Map<string, ProviderModelRoute[]>(),
  provider: undefined as Provider | undefined,
  providers: [] as Provider[],
  providerCooldowns: [] as Array<{ providerId: string; cooldownUntilTime: number | null }>,
  modelCooldowns: [] as Array<{ providerModelId: string; cooldownUntilTime: number | null }>,
  unavailableProviders: new Set<string>(),
  unavailableModels: new Set<string>(),
}))

vi.mock('@server/database/model-store', () => ({
  listProviderModelsForLogicalModel: async () => mocks.models,
  listProviderModelsForLogicalModels: async () => mocks.modelsByLogicalModel,
}))

vi.mock('@server/database/provider-store', () => ({
  getProvider: async () => mocks.provider,
  listProviders: async () => mocks.providers,
}))

vi.mock('@server/database/health-store', () => ({
  listProviderHealth: async () => mocks.providerCooldowns,
  listProviderModelHealth: async () => mocks.modelCooldowns,
}))

vi.mock('@server/proxy/upstream/health', () => ({
  isProviderAvailable: async (providerId: string) => !mocks.unavailableProviders.has(providerId),
  isProviderModelAvailable: async (providerModelId: string) => !mocks.unavailableModels.has(providerModelId),
}))

afterEach(() => {
  mocks.models = []
  mocks.modelsByLogicalModel.clear()
  mocks.provider = undefined
  mocks.providers = []
  mocks.providerCooldowns = []
  mocks.modelCooldowns = []
  mocks.unavailableProviders.clear()
  mocks.unavailableModels.clear()
})

describe('getAvailableModels', () => {
  it('keeps available models first and preserves original order within each group', async () => {
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
      { id: 'model_a', providerId: 'prov_shared', modelName: 'a', endpoints: [], priority: 1, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_b', providerId: 'prov_shared', modelName: 'b', endpoints: [], priority: 2, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_c', providerId: 'prov_shared', modelName: 'c', endpoints: [], priority: 3, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_d', providerId: 'prov_shared', modelName: 'd', endpoints: [], priority: 4, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
    ]
    mocks.unavailableModels.add('model_b')
    mocks.unavailableModels.add('model_d')

    const available = await getAvailableModels('default')

    expect(available.map(entry => entry.model.id)).toEqual(['model_a', 'model_c', 'model_b', 'model_d'])
  })

  it('filters disabled models while keeping available and unavailable order', async () => {
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
      { id: 'model_available_first', providerId: 'prov_shared', modelName: 'available-first', endpoints: [], priority: 1, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_disabled_first', providerId: 'prov_shared', modelName: 'disabled-first', endpoints: [], priority: 2, enabled: false, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_unavailable_first', providerId: 'prov_shared', modelName: 'unavailable-first', endpoints: [], priority: 3, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_disabled_second', providerId: 'prov_shared', modelName: 'disabled-second', endpoints: [], priority: 4, enabled: false, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_available_second', providerId: 'prov_shared', modelName: 'available-second', endpoints: [], priority: 5, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_unavailable_second', providerId: 'prov_shared', modelName: 'unavailable-second', endpoints: [], priority: 6, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
    ]
    mocks.unavailableModels.add('model_unavailable_first')
    mocks.unavailableModels.add('model_unavailable_second')

    const available = await getAvailableModels('default')

    expect(available.map(entry => entry.model.id)).toEqual([
      'model_available_first',
      'model_available_second',
      'model_unavailable_first',
      'model_unavailable_second',
    ])
    expect(available.some(entry => entry.model.id.startsWith('model_disabled'))).toBe(false)
  })

  it('skips disabled providers in automatic routing', async () => {
    const time = Date.now()
    mocks.provider = {
      id: 'prov_disabled',
      name: 'Disabled Provider',
      apiKeyReference: 'disabled-key',
      timeoutMilliseconds: 1_000,
      enabled: false,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    }
    mocks.models = [
      { id: 'model_disabled_provider', providerId: 'prov_disabled', modelName: 'disabled-provider', endpoints: [], priority: 1, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
    ]

    const available = await getAvailableModels('default')

    expect(available).toEqual([])
  })

  it('skips deleted providers in automatic routing', async () => {
    const time = Date.now()
    mocks.provider = {
      id: 'prov_deleted',
      name: 'Deleted Provider',
      apiKeyReference: 'deleted-key',
      timeoutMilliseconds: 1_000,
      enabled: true,
      createdTime: time,
      updatedTime: time,
      deletedTime: time,
    }
    mocks.models = [
      { id: 'model_deleted_provider', providerId: 'prov_deleted', modelName: 'deleted-provider', endpoints: [], priority: 1, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
    ]

    const available = await getAvailableModels('default')

    expect(available).toEqual([])
  })

  it('keeps cooled provider models behind healthy ones', async () => {
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

    const available = await getAvailableModels('default')

    expect(available.map(entry => entry.model.id)).toEqual(['model_ready', 'model_cooled'])
  })

  it('returns the full candidate list in order when every model is unavailable', async () => {
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
      { id: 'model_first', providerId: 'prov_shared', modelName: 'first', endpoints: [], priority: 1, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_second', providerId: 'prov_shared', modelName: 'second', endpoints: [], priority: 2, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
    ]
    mocks.unavailableModels.add('model_first')
    mocks.unavailableModels.add('model_second')

    const available = await getAvailableModels('default')

    expect(available.map(entry => entry.model.id)).toEqual(['model_first', 'model_second'])
  })

  it('excludes disabled models from automatic routing', async () => {
    const time = Date.now()
    mocks.provider = {
      id: 'prov_shared', name: 'Shared Provider', apiKeyReference: 'shared-key', timeoutMilliseconds: 1_000,
      enabled: true, createdTime: time, updatedTime: time, deletedTime: null,
    }
    mocks.models = [
      { id: 'model_disabled', providerId: 'prov_shared', modelName: 'disabled', endpoints: [], priority: 1, enabled: false, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_ready', providerId: 'prov_shared', modelName: 'ready', endpoints: [], priority: 2, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
    ]

    const available = await getAvailableModels('default')

    expect(available.map(entry => entry.model.id)).toEqual(['model_ready'])
  })

  it('forces the manually selected model despite disabled and cooling states', async () => {
    const time = Date.now()
    mocks.provider = {
      id: 'prov_shared', name: 'Shared Provider', apiKeyReference: 'shared-key', timeoutMilliseconds: 1_000,
      enabled: false, createdTime: time, updatedTime: time, deletedTime: null,
    }
    mocks.models = [
      { id: 'model_other', providerId: 'prov_shared', modelName: 'other', endpoints: [], priority: 1, enabled: true, createdTime: time, updatedTime: time, deletedTime: null },
      { id: 'model_manual', providerId: 'prov_shared', modelName: 'manual', endpoints: [], priority: 2, enabled: false, createdTime: time, updatedTime: time, deletedTime: null },
    ]
    mocks.unavailableProviders.add('prov_shared')
    mocks.unavailableModels.add('model_manual')

    const available = await getAvailableModels('default', { manualModelId: 'model_manual' })

    expect(available.map(entry => entry.model.id)).toEqual(['model_manual'])
  })
})

describe('getAvailableModelsBatch', () => {
  it('matches the single-landing filtering and ordering for every logical model', async () => {
    const time = Date.now()
    const provider: Provider = {
      id: 'prov_shared',
      name: 'Shared Provider',
      apiKeyReference: 'shared-key',
      timeoutMilliseconds: 1_000,
      enabled: true,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    }
    const first = logicalModel('model_first', provider.id, 1, time)
    const disabled = logicalModel('model_disabled', provider.id, 2, time, false)
    const cooled = logicalModel('model_cooled', provider.id, 3, time)
    const ready = logicalModel('model_ready', provider.id, 4, time)
    mocks.provider = provider
    mocks.models = [first, disabled, cooled, ready]
    mocks.unavailableModels.add(cooled.id)
    mocks.modelsByLogicalModel.set('landing_one', [first, disabled, cooled, ready])
    mocks.modelsByLogicalModel.set('landing_two', [ready, first])
    mocks.providers = [provider]
    mocks.modelCooldowns = [{ providerModelId: cooled.id, cooldownUntilTime: time + 60_000 }]

    const single = await getAvailableModels('landing_one')
    const batch = await getAvailableModelsBatch([
      { logicalModelId: 'landing_one', manualModelId: null },
      { logicalModelId: 'landing_two', manualModelId: null },
    ])

    expect(batch.get('landing_one')?.map(entry => entry.model.id)).toEqual(single.map(entry => entry.model.id))
    expect(batch.get('landing_two')?.map(entry => entry.model.id)).toEqual(['model_ready', 'model_first'])
  })

  it('keeps the manually selected model even when it is disabled and cooling', async () => {
    const time = Date.now()
    const provider: Provider = {
      id: 'prov_shared',
      name: 'Shared Provider',
      apiKeyReference: 'shared-key',
      timeoutMilliseconds: 1_000,
      enabled: false,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    }
    const manual = logicalModel('model_manual', provider.id, 1, time, false)
    const other = logicalModel('model_other', provider.id, 2, time)
    mocks.modelsByLogicalModel.set('landing', [other, manual])
    mocks.providers = [provider]
    mocks.providerCooldowns = [{ providerId: provider.id, cooldownUntilTime: time + 60_000 }]
    mocks.modelCooldowns = [{ providerModelId: manual.id, cooldownUntilTime: time + 60_000 }]

    const batch = await getAvailableModelsBatch([{ logicalModelId: 'landing', manualModelId: manual.id }])

    expect(batch.get('landing')?.map(entry => entry.model.id)).toEqual([manual.id])
  })
})

function logicalModel(id: string, providerId: string, priority: number, time: number, enabled = true): ProviderModelRoute {
  return {
    id,
    providerId,
    modelName: id,
    endpoints: [],
    priority,
    enabled,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
}

describe('findEndpoint', () => {
  const model: ProviderModelRoute = {
    id: 'model_1',
    providerId: 'prov_1',
    modelName: 'upstream-1',
    endpoints: [
      { protocol: 'openai-completions', endpointUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: false },
      { protocol: 'anthropic-messages', endpointUrl: 'https://b.example.com', customAuthHeader: 'Bearer x', protocolConversionEnabled: false },
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
        { protocol: 'openai-completions', endpointUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: true },
      ],
    }
    expect(findConvertibleEndpoint(model, 'anthropic-messages')?.protocol).toBe('openai-completions')
    expect(findConvertibleEndpoint(model, 'openai-responses')?.protocol).toBe('openai-completions')
  })

  it('ignores endpoints without protocolConversionEnabled', () => {
    const model: ProviderModelRoute = {
      ...base,
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: false },
      ],
    }
    expect(findConvertibleEndpoint(model, 'anthropic-messages')).toBeUndefined()
  })

  it('ignores endpoints whose protocol cannot serve the client protocol', () => {
    const model: ProviderModelRoute = {
      ...base,
      endpoints: [
        { protocol: 'openai-responses', endpointUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: true },
      ],
    }
    expect(findConvertibleEndpoint(model, 'anthropic-messages')).toBeUndefined()
    expect(findConvertibleEndpoint(model, 'openai-completions')).toBeUndefined()
  })

  it('does not match an endpoint serving its own protocol', () => {
    const model: ProviderModelRoute = {
      ...base,
      endpoints: [
        { protocol: 'openai-completions', endpointUrl: 'https://a.example.com', customAuthHeader: null, protocolConversionEnabled: true },
      ],
    }
    expect(findConvertibleEndpoint(model, 'openai-completions')).toBeUndefined()
  })
})

describe('缓存亲和', () => {
  const time = Date.now()
  const sharedProvider: Provider = {
    id: 'prov_shared',
    name: 'Shared Provider',
    apiKeyReference: 'shared-key',
    timeoutMilliseconds: 1_000,
    enabled: true,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
  const model = (id: string, priority: number): ProviderModelRoute => ({
    id,
    providerId: 'prov_shared',
    modelName: id,
    endpoints: [],
    priority,
    enabled: true,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  })

  function seedFourModels(): void {
    mocks.provider = sharedProvider
    mocks.models = [model('model_a', 1), model('model_b', 2), model('model_c', 3), model('model_d', 4)]
  }

  it('moves a healthy bound model to the front of the available group', async () => {
    seedFourModels()
    mocks.unavailableModels.add('model_d')

    const available = await getAvailableModels('default', { affinityProviderModelId: 'model_c' })

    // 绑定的是健康组里的第二位：前置后其余候选的相对顺序不动，冷却中的 model_d 仍垫底。
    expect(available.map(entry => entry.model.id)).toEqual(['model_c', 'model_a', 'model_b', 'model_d'])
  })

  it('keeps a cooling bound model in the unavailable tail', async () => {
    seedFourModels()
    mocks.unavailableModels.add('model_a')

    const available = await getAvailableModels('default', { affinityProviderModelId: 'model_a' })

    // 绑定候选正在冷却：把它提到队首等于主动迎着冷却与全价 prefill 撞上去，因此保持队尾原位。
    expect(available.map(entry => entry.model.id)).toEqual(['model_b', 'model_c', 'model_d', 'model_a'])
  })

  it('keeps the scheduling order when no affinity is given', async () => {
    seedFourModels()
    mocks.unavailableModels.add('model_b')

    const available = await getAvailableModels('default', { affinityProviderModelId: null })

    expect(available.map(entry => entry.model.id)).toEqual(['model_a', 'model_c', 'model_d', 'model_b'])
  })

  it('resolves the binding per landing in batch planning', async () => {
    seedFourModels()
    mocks.providers = [sharedProvider]
    mocks.modelsByLogicalModel.set('default', mocks.models)
    mocks.modelsByLogicalModel.set('landing', mocks.models)

    const batch = await getAvailableModelsBatch([
      { logicalModelId: 'default', manualModelId: null, affinityProviderModelId: 'model_c' },
      { logicalModelId: 'landing', manualModelId: null, affinityProviderModelId: null },
    ])

    // 亲和是「逻辑模型 + 会话键」命名空间下的：每个落点只吃自己的绑定。
    expect(batch.get('default')!.map(entry => entry.model.id)).toEqual(['model_c', 'model_a', 'model_b', 'model_d'])
    expect(batch.get('landing')!.map(entry => entry.model.id)).toEqual(['model_a', 'model_b', 'model_c', 'model_d'])
  })
})
