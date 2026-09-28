import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogicalModel, LogicalModelProviderModel, Provider } from '@common/schemas'

const mocks = vi.hoisted(() => ({
  listLogicalModels: vi.fn(),
  listProviderModelsForLogicalModels: vi.fn(),
  listProviders: vi.fn(),
  listProviderHealth: vi.fn(),
  listProviderModelHealth: vi.fn(),
  listRequestLogs: vi.fn(),
  listAttemptsByRequests: vi.fn(),
}))

vi.mock('../database/logical-model-store', () => ({
  listLogicalModels: mocks.listLogicalModels,
}))

vi.mock('../database/model-store', () => ({
  listProviderModelsForLogicalModels: mocks.listProviderModelsForLogicalModels,
}))

vi.mock('../database/provider-store', () => ({
  listProviders: mocks.listProviders,
}))

vi.mock('../database/health-store', () => ({
  listProviderHealth: mocks.listProviderHealth,
  listProviderModelHealth: mocks.listProviderModelHealth,
}))

vi.mock('../database/request-log-store', () => ({
  listRequestLogs: mocks.listRequestLogs,
  listAttemptsByRequests: mocks.listAttemptsByRequests,
}))

import { listTrayLogicalModels } from './tray-summary'

function logicalModel(overrides: Partial<LogicalModel> = {}): LogicalModel {
  return {
    id: 'lm_default',
    name: 'default',
    description: '',
    enabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

function providerModel(overrides: Partial<LogicalModelProviderModel> = {}): LogicalModelProviderModel {
  return {
    id: 'model_1',
    providerId: 'prov_1',
    modelName: 'gpt-test',
    endpoints: [],
    priority: 0,
    enabled: true,
    modelEnabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'prov_1',
    name: 'Primary',
    enabled: true,
    description: '',
    apiKeyReference: 'secret',
    timeoutMilliseconds: 30_000,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listProviders.mockResolvedValue([])
  mocks.listProviderHealth.mockResolvedValue([])
  mocks.listProviderModelHealth.mockResolvedValue([])
  mocks.listRequestLogs.mockResolvedValue([])
  mocks.listAttemptsByRequests.mockResolvedValue([])
})

describe('tray logical model summary', () => {
  it('projects the model list, protocol conversion, cooling state and metrics', async () => {
    mocks.listLogicalModels.mockResolvedValue([logicalModel()])
    mocks.listProviderModelsForLogicalModels.mockResolvedValue(new Map([
      ['lm_default', [
        providerModel({
          endpoints: [
            { protocol: 'openai-completions', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: true },
            { protocol: 'anthropic-messages', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false },
          ],
        }),
        providerModel({ id: 'model_2', modelName: 'disabled-model', modelEnabled: false }),
      ]],
    ]))
    mocks.listProviders.mockResolvedValue([provider()])
    mocks.listProviderHealth.mockResolvedValue([{
      providerId: 'prov_1',
      consecutiveFailures: 2,
      cooldownUntilTime: null,
      lastSuccessTime: 400,
      lastFailureTime: 500,
      updatedTime: 500,
    }])
    mocks.listProviderModelHealth.mockResolvedValue([
      {
        providerModelId: 'model_1',
        consecutiveFailures: 0,
        cooldownUntilTime: Date.now() + 60_000,
        lastSuccessTime: null,
        lastFailureTime: null,
        updatedTime: 500,
      },
      {
        providerModelId: 'model_2',
        consecutiveFailures: 3,
        cooldownUntilTime: null,
        lastSuccessTime: null,
        lastFailureTime: 500,
        updatedTime: 500,
      },
    ])
    mocks.listRequestLogs.mockResolvedValue([
      { id: 'req_success', status: 'success', outputTokens: 100 },
      { id: 'req_failed', status: 'failed', outputTokens: null },
    ])
    mocks.listAttemptsByRequests.mockResolvedValue([
      {
        requestId: 'req_success',
        status: 'success',
        providerId: 'prov_1',
        providerModelId: 'model_1',
        ttftMilliseconds: 250,
        durationMilliseconds: 2_000,
      },
    ])

    await expect(listTrayLogicalModels()).resolves.toEqual([
      {
        id: 'lm_default',
        name: 'default',
        models: [
          {
            id: 'model_1',
            providerId: 'prov_1',
            providerName: 'Primary',
            modelName: 'gpt-test',
            protocols: ['openai-completions', 'anthropic-messages'],
            conversionProtocols: ['openai-responses'],
            enabled: true,
            modelEnabled: true,
            cooling: true,
            avgTps: 50,
            avgTtftMilliseconds: 250,
          },
          expect.objectContaining({
            id: 'model_2',
            modelEnabled: false,
            cooling: false,
            avgTps: null,
            avgTtftMilliseconds: null,
          }),
        ],
      },
    ])
    expect(mocks.listProviderModelsForLogicalModels).toHaveBeenCalledWith(['lm_default'], false, true)
    expect(mocks.listRequestLogs).toHaveBeenCalledWith(100, 0, { logicalModelId: 'lm_default' })
    expect(mocks.listAttemptsByRequests).toHaveBeenCalledWith(['req_success', 'req_failed'])
  })

  it('keeps logical models with no bindings visible', async () => {
    mocks.listLogicalModels.mockResolvedValue([logicalModel({ id: 'lm_empty', name: 'Empty', enabled: false })])
    mocks.listProviderModelsForLogicalModels.mockResolvedValue(new Map())

    await expect(listTrayLogicalModels()).resolves.toEqual([
      { id: 'lm_empty', name: 'Empty', models: [] },
    ])
  })
})
