import type { KeychainApi } from '@common/keychain'
import { inArray } from 'drizzle-orm'
import { getDb } from './index'
import {
  logicalModels,
  providerHealth,
  providers,
  requestAttempts,
  requestLogs,
  upstreamModels,
} from './schema'

const PROVIDER_FIXTURES = [
  {
    id: 'prov_dev_openai',
    name: 'OpenAI（开发示例）',
    apiKeyReference: 'key_dev_openai',
    apiKey: 'sk-development-openai',
    upstreamUrls: {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    },
  },
  {
    id: 'prov_dev_anthropic',
    name: 'Anthropic（开发示例）',
    apiKeyReference: 'key_dev_anthropic',
    apiKey: 'sk-development-anthropic',
    upstreamUrls: {
      'anthropic-messages': 'https://api.anthropic.com/v1/messages',
    },
  },
  {
    id: 'prov_dev_ark',
    name: '火山方舟（开发示例）',
    apiKeyReference: 'key_dev_ark',
    apiKey: 'development-ark-key',
    upstreamUrls: {
      'openai-completions': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      'openai-responses': 'https://ark.cn-beijing.volces.com/api/v3/responses',
    },
  },
  {
    id: 'prov_dev_deepseek',
    name: 'DeepSeek（开发示例）',
    apiKeyReference: 'key_dev_deepseek',
    apiKey: 'sk-development-deepseek',
    upstreamUrls: {
      'openai-completions': 'https://api.deepseek.com/chat/completions',
    },
  },
  {
    id: 'prov_dev_all_protocols',
    name: '协议实验室（开发示例）',
    apiKeyReference: 'key_dev_all_protocols',
    apiKey: 'sk-development-all-protocols',
    upstreamUrls: {
      'openai-completions': 'https://api.example.com/v1/chat/completions',
      'openai-responses': 'https://api.example.com/v1/responses',
      'anthropic-messages': 'https://api.example.com/v1/messages',
    },
  },
] as const

const LOGICAL_MODEL_FIXTURES = [
  { id: 'model_dev_default', name: 'default', description: '日常对话与通用任务' },
  { id: 'model_dev_reasoning', name: 'reasoning', description: '复杂推理与代码任务' },
  { id: 'model_dev_fast', name: 'fast', description: '低延迟轻量请求' },
] as const

const UPSTREAM_MODEL_FIXTURES = [
  ['model_dev_default', 'prov_dev_ark', 'doubao-seed-1-6', 'openai-completions', 1],
  ['model_dev_default', 'prov_dev_openai', 'gpt-4.1-mini', 'openai-responses', 2],
  ['model_dev_default', 'prov_dev_anthropic', 'claude-sonnet-4', 'anthropic-messages', 3],
  ['model_dev_reasoning', 'prov_dev_deepseek', 'deepseek-reasoner', 'openai-completions', 1],
  ['model_dev_reasoning', 'prov_dev_openai', 'o3', 'openai-responses', 2],
  ['model_dev_fast', 'prov_dev_ark', 'doubao-seed-1-6-flash', 'openai-completions', 1],
  ['model_dev_fast', 'prov_dev_deepseek', 'deepseek-chat', 'openai-completions', 2],
  ['model_dev_default', 'prov_dev_all_protocols', 'universal-chat', 'all', 4],
  ['model_dev_reasoning', 'prov_dev_all_protocols', 'universal-reasoner', 'all', 3],
  ['model_dev_fast', 'prov_dev_all_protocols', 'universal-fast', 'all', 3],
] as const

const ALL_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

const DEVELOPMENT_REQUEST_COUNT = 30

interface DevelopmentSeedOptions {
  allowExisting?: boolean
}

export async function seedDevelopmentData(secretStore: KeychainApi, options: DevelopmentSeedOptions = {}): Promise<boolean> {
  const db = getDb()
  const hasConfiguration = Boolean(
    db.select({ id: providers.id }).from(providers).limit(1).get()
    || db.select({ id: logicalModels.id }).from(logicalModels).limit(1).get()
    || db.select({ id: requestLogs.id }).from(requestLogs).limit(1).get(),
  )
  if (hasConfiguration && !options.allowExisting) return false

  const existingProviderIds = new Set(
    db.select({ id: providers.id }).from(providers).where(inArray(providers.id, PROVIDER_FIXTURES.map(provider => provider.id))).all().map(row => row.id),
  )
  const existingHealthProviderIds = new Set(
    db.select({ id: providerHealth.providerId }).from(providerHealth).where(inArray(providerHealth.providerId, PROVIDER_FIXTURES.map(provider => provider.id))).all().map(row => row.id),
  )
  const existingLogicalModelIds = new Set(
    db.select({ id: logicalModels.id }).from(logicalModels).where(inArray(logicalModels.id, LOGICAL_MODEL_FIXTURES.map(model => model.id))).all().map(row => row.id),
  )
  const existingUpstreamModelIds = new Set(
    db.select({ id: upstreamModels.id }).from(upstreamModels).where(inArray(upstreamModels.id, UPSTREAM_MODEL_FIXTURES.map((_, index) => `model_dev_upstream_${index + 1}`))).all().map(row => row.id),
  )
  const existingRequestIds = new Set(
    db.select({ id: requestLogs.id }).from(requestLogs).where(inArray(requestLogs.id, Array.from({ length: DEVELOPMENT_REQUEST_COUNT }, (_, index) => `req_dev_${String(index + 1).padStart(2, '0')}`))).all().map(row => row.id),
  )
  const hasMissingFixtures =
    existingProviderIds.size < PROVIDER_FIXTURES.length
    || existingHealthProviderIds.size < PROVIDER_FIXTURES.length
    || existingLogicalModelIds.size < LOGICAL_MODEL_FIXTURES.length
    || existingUpstreamModelIds.size < UPSTREAM_MODEL_FIXTURES.length
    || existingRequestIds.size < 18

  for (const provider of PROVIDER_FIXTURES) {
    if (!existingProviderIds.has(provider.id)) await secretStore.set(provider.apiKeyReference, provider.apiKey)
  }

  const timestamp = Date.now()
  db.transaction(transaction => {
    const providersToInsert = PROVIDER_FIXTURES.filter(provider => !existingProviderIds.has(provider.id))
    if (providersToInsert.length > 0) transaction.insert(providers).values(providersToInsert.map(provider => ({
      id: provider.id,
      name: provider.name,
      apiKeyReference: provider.apiKeyReference,
      timeoutMilliseconds: 30_000,
      enabled: true,
      upstreamUrls: JSON.stringify(provider.upstreamUrls),
      createdTime: timestamp,
      updatedTime: timestamp,
    }))).run()

    const healthToInsert = PROVIDER_FIXTURES.filter(provider => !existingHealthProviderIds.has(provider.id))
    if (healthToInsert.length > 0) transaction.insert(providerHealth).values(healthToInsert.map(provider => {
      const index = PROVIDER_FIXTURES.findIndex(item => item.id === provider.id)
      return {
      providerId: provider.id,
      consecutiveFailures: index === 3 ? 1 : 0,
      lastSuccessTime: timestamp - (index + 1) * 90_000,
      lastFailureTime: index === 3 ? timestamp - 45_000 : null,
      updatedTime: timestamp,
      }
    })).run()

    const logicalModelsToInsert = LOGICAL_MODEL_FIXTURES.filter(model => !existingLogicalModelIds.has(model.id))
    if (logicalModelsToInsert.length > 0) transaction.insert(logicalModels).values(logicalModelsToInsert.map(model => ({
      ...model,
      enabled: true,
      createdTime: timestamp,
      updatedTime: timestamp,
    }))).run()

    const upstreamModelsToInsert = UPSTREAM_MODEL_FIXTURES.map((fixture, index) => ({ fixture, index })).filter(({ index }) => !existingUpstreamModelIds.has(`model_dev_upstream_${index + 1}`))
    if (upstreamModelsToInsert.length > 0) transaction.insert(upstreamModels).values(upstreamModelsToInsert.map(({ fixture, index }) => ({
      id: `model_dev_upstream_${index + 1}`,
      logicalModelId: fixture[0],
      providerId: fixture[1],
      upstreamModelId: fixture[2],
      endpoints: JSON.stringify((fixture[3] === 'all' ? ALL_PROTOCOLS : [fixture[3]]).map(protocol => ({ protocol, upstreamUrl: '', customAuthHeader: null }))),
      priority: fixture[4],
      enabled: true,
      createdTime: timestamp,
      updatedTime: timestamp,
    }))).run()

    const sampleRequests = Array.from({ length: DEVELOPMENT_REQUEST_COUNT }, (_, index) => {
      const failed = index === 4 || index === 11
      const logicalModel = LOGICAL_MODEL_FIXTURES[index % LOGICAL_MODEL_FIXTURES.length]
      const provider = PROVIDER_FIXTURES[index % PROVIDER_FIXTURES.length]
      const duration = 480 + (index * 173) % 2_400
      const inputTokens = 320 + index * 47
      const outputTokens = 80 + (index * 29) % 360
      return {
        id: `req_dev_${String(index + 1).padStart(2, '0')}`,
        logicalModelId: logicalModel.id,
        protocol: index % 3 === 0 ? 'openai-completions' : index % 3 === 1 ? 'openai-responses' : 'anthropic-messages',
        status: failed ? 'failed' : 'success',
        totalDurationMilliseconds: duration,
        totalTokens: failed ? null : inputTokens + outputTokens,
        inputTokens: failed ? null : inputTokens,
        outputTokens: failed ? null : outputTokens,
        cachedInputTokens: failed ? null : index % 3 === 0 ? 256 : 0,
        cacheCreationInputTokens: failed ? null : index % 5 === 0 ? 128 : 0,
        promptCacheHit: failed ? null : index % 3 === 0,
        rawUsage: null,
        ttftMilliseconds: failed ? null : 110 + (index * 31) % 420,
        cacheHit: failed ? null : index % 3 === 0,
        createdTime: timestamp - index * 3_600_000,
        provider,
        failed,
      }
    })

    const requestsToInsert = sampleRequests.filter(request => !existingRequestIds.has(request.id))
    if (requestsToInsert.length > 0) transaction.insert(requestLogs).values(requestsToInsert.map(({ provider: _provider, failed: _failed, ...request }) => request)).run()
    if (requestsToInsert.length > 0) transaction.insert(requestAttempts).values(requestsToInsert.map(request => ({
      id: `att_dev_${request.id.slice(-2)}`,
      requestId: request.id,
      providerId: request.provider.id,
      upstreamModelId: UPSTREAM_MODEL_FIXTURES[(Number(request.id.slice(-2)) - 1) % UPSTREAM_MODEL_FIXTURES.length][2],
      attemptIndex: 0,
      status: request.status,
      errorCode: request.failed ? 'UPSTREAM_TIMEOUT' : null,
      errorMessage: request.failed ? '开发示例：上游请求超时' : null,
      durationMilliseconds: request.totalDurationMilliseconds,
      createdTime: request.createdTime,
    }))).run()
  })

  return hasMissingFixtures
}
