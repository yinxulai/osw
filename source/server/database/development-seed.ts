import type { KeychainApi } from '@common/keychain'
import { inArray } from 'drizzle-orm'
import { getDb } from './index'
import {
  providerEndpoints,
  providerHealth,
  providerModelEndpoints,
  providerModelHealth,
  providerModels,
  providerSettings,
  providers,
  requestAttempts,
  requestLogs,
  requestMetrics,
  requestUsages,
  schedulingPolicies,
} from './schema'

const PROVIDER_FIXTURES = [
  {
    id: 'prov_dev_openai',
    name: 'OpenAI（开发示例）',
    apiKeyReference: 'key_dev_openai',
    apiKey: 'sk-development-openai',
    endpoints: {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    },
  },
  {
    id: 'prov_dev_anthropic',
    name: 'Anthropic（开发示例）',
    apiKeyReference: 'key_dev_anthropic',
    apiKey: 'sk-development-anthropic',
    endpoints: {
      'anthropic-messages': 'https://api.anthropic.com/v1/messages',
    },
  },
  {
    id: 'prov_dev_ark',
    name: '火山方舟（开发示例）',
    apiKeyReference: 'key_dev_ark',
    apiKey: 'development-ark-key',
    endpoints: {
      'openai-completions': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      'openai-responses': 'https://ark.cn-beijing.volces.com/api/v3/responses',
    },
  },
  {
    id: 'prov_dev_deepseek',
    name: 'DeepSeek（开发示例）',
    apiKeyReference: 'key_dev_deepseek',
    apiKey: 'sk-development-deepseek',
    endpoints: {
      'openai-completions': 'https://api.deepseek.com/chat/completions',
    },
  },
  {
    id: 'prov_dev_all_protocols',
    name: '协议实验室（开发示例）',
    apiKeyReference: 'key_dev_all_protocols',
    apiKey: 'sk-development-all-protocols',
    endpoints: {
      'openai-completions': 'https://api.example.com/v1/chat/completions',
      'openai-responses': 'https://api.example.com/v1/responses',
      'anthropic-messages': 'https://api.example.com/v1/messages',
    },
  },
] as const

const UPSTREAM_MODEL_FIXTURES = [
  ['default', 'prov_dev_ark', 'doubao-seed-1-6', 'openai-completions', 1],
  ['default', 'prov_dev_openai', 'gpt-4.1-mini', 'openai-responses', 2],
  ['default', 'prov_dev_anthropic', 'claude-sonnet-4', 'anthropic-messages', 3],
  ['default', 'prov_dev_deepseek', 'deepseek-reasoner', 'openai-completions', 4],
  ['default', 'prov_dev_openai', 'o3', 'openai-responses', 5],
  ['default', 'prov_dev_ark', 'doubao-seed-1-6-flash', 'openai-completions', 6],
  ['default', 'prov_dev_deepseek', 'deepseek-chat', 'openai-completions', 7],
  ['default', 'prov_dev_all_protocols', 'universal-chat', 'all', 8],
  ['default', 'prov_dev_all_protocols', 'universal-reasoner', 'all', 9],
  ['default', 'prov_dev_all_protocols', 'universal-fast', 'all', 10],
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
  // 注意：logical_models 不参与判断 —— 初始化时会自动创建 default 逻辑模型，不代表用户已有配置
  const hasConfiguration = Boolean(
    db.select({ id: providers.id }).from(providers).limit(1).get()
    || db.select({ id: requestLogs.id }).from(requestLogs).limit(1).get(),
  )
  if (hasConfiguration && !options.allowExisting) return false

  const existingProviderIds = new Set(
    db.select({ id: providers.id }).from(providers).where(inArray(providers.id, PROVIDER_FIXTURES.map(provider => provider.id))).all().map(row => row.id),
  )
  const existingHealthProviderIds = new Set(
    db.select({ id: providerHealth.providerId }).from(providerHealth).where(inArray(providerHealth.providerId, PROVIDER_FIXTURES.map(provider => provider.id))).all().map(row => row.id),
  )
  const existingUpstreamModelIds = new Set(
    db.select({ id: providerModels.id }).from(providerModels).where(inArray(providerModels.id, UPSTREAM_MODEL_FIXTURES.map((_, index) => `model_dev_upstream_${index + 1}`))).all().map(row => row.id),
  )
  const existingRequestIds = new Set(
    db.select({ id: requestLogs.id }).from(requestLogs).where(inArray(requestLogs.id, Array.from({ length: DEVELOPMENT_REQUEST_COUNT }, (_, index) => `req_dev_${String(index + 1).padStart(2, '0')}`))).all().map(row => row.id),
  )
  const hasMissingFixtures =
    existingProviderIds.size < PROVIDER_FIXTURES.length
    || existingHealthProviderIds.size < PROVIDER_FIXTURES.length
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
      description: '开发示例供应商',
      enabled: true,
      createdTime: timestamp,
      updatedTime: timestamp,
    }))).run()
    if (providersToInsert.length > 0) transaction.insert(providerSettings).values(providersToInsert.flatMap(provider => [
      { providerId: provider.id, key: 'security.secretReference', value: provider.apiKeyReference, valueType: 'string', updatedTime: timestamp },
      { providerId: provider.id, key: 'connection.timeoutMilliseconds', value: '30000', valueType: 'number', updatedTime: timestamp },
    ])).run()

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

    const upstreamModelsToInsert = UPSTREAM_MODEL_FIXTURES.map((fixture, index) => ({ fixture, index })).filter(({ index }) => !existingUpstreamModelIds.has(`model_dev_upstream_${index + 1}`))
    if (upstreamModelsToInsert.length > 0) {
      transaction.insert(providerModels).values(upstreamModelsToInsert.map(({ fixture, index }) => ({
        id: `model_dev_upstream_${index + 1}`,
        providerId: fixture[1],
        modelName: fixture[2],
        enabled: true,
        createdTime: timestamp,
        updatedTime: timestamp,
      }))).run()
      transaction.insert(providerModelHealth).values(upstreamModelsToInsert.map(({ index }) => ({ providerModelId: `model_dev_upstream_${index + 1}`, updatedTime: timestamp }))).run()
      for (const { fixture, index } of upstreamModelsToInsert) {
        const protocols = fixture[3] === 'all' ? ALL_PROTOCOLS : [fixture[3]]
        for (const protocol of protocols) {
          const endpointId = `endpoint_dev_${fixture[1]}_${protocol}`
          const url = PROVIDER_FIXTURES.find(provider => provider.id === fixture[1])?.endpoints[protocol as keyof typeof PROVIDER_FIXTURES[number]['endpoints']] ?? 'https://api.example.com'
          const existingEndpoint = transaction.select().from(providerEndpoints).where(inArray(providerEndpoints.id, [endpointId])).get()
          if (!existingEndpoint) transaction.insert(providerEndpoints).values({ id: endpointId, providerId: fixture[1], protocol, url, enabled: true, createdTime: timestamp, updatedTime: timestamp }).run()
          transaction.insert(providerModelEndpoints).values({ id: `binding_dev_${index}_${protocol}`, providerModelId: `model_dev_upstream_${index + 1}`, providerEndpointId: endpointId, url: null, enabled: true, createdTime: timestamp, updatedTime: timestamp }).run()
        }
        transaction.insert(schedulingPolicies).values({ logicalModelId: fixture[0], providerModelId: `model_dev_upstream_${index + 1}`, priority: fixture[4], weight: 100, enabled: true, createdTime: timestamp, updatedTime: timestamp }).run()
      }
    }

    const sampleRequests = Array.from({ length: DEVELOPMENT_REQUEST_COUNT }, (_, index) => {
      const failed = index === 4 || index === 11
      const provider = PROVIDER_FIXTURES[index % PROVIDER_FIXTURES.length]
      const duration = 480 + (index * 173) % 2_400
      const inputTokens = 320 + index * 47
      const outputTokens = 80 + (index * 29) % 360
      return {
        id: `req_dev_${String(index + 1).padStart(2, '0')}`,
        logicalModelId: 'default',
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
    if (requestsToInsert.length > 0) transaction.insert(requestLogs).values(requestsToInsert.map(request => ({
      id: request.id,
      logicalModelId: request.logicalModelId,
      protocol: request.protocol,
      status: request.status,
      metadata: null,
      createdTime: request.createdTime,
    }))).run()
    if (requestsToInsert.length > 0) transaction.insert(requestMetrics).values(requestsToInsert.map(request => ({ requestId: request.id, key: 'durationMilliseconds', value: request.totalDurationMilliseconds, unit: 'milliseconds', updatedTime: timestamp }))).run()
    const usages = requestsToInsert.flatMap(request => request.totalTokens == null ? [] : [{ id: `usage_dev_${request.id.slice(-2)}`, requestId: request.id, attemptId: null, type: 'totalTokens', value: request.totalTokens, unit: 'tokens', createdTime: request.createdTime }])
    if (usages.length > 0) transaction.insert(requestUsages).values(usages).run()
    if (requestsToInsert.length > 0) transaction.insert(requestAttempts).values(requestsToInsert.map(request => {
      const fixture = UPSTREAM_MODEL_FIXTURES[(Number(request.id.slice(-2)) - 1) % UPSTREAM_MODEL_FIXTURES.length]
      const providerModelId = `model_dev_upstream_${(Number(request.id.slice(-2)) - 1) % UPSTREAM_MODEL_FIXTURES.length + 1}`
      return {
        id: `att_dev_${request.id.slice(-2)}`,
        requestId: request.id,
        providerId: request.provider.id,
        providerModelId,
        providerName: request.provider.name,
        providerModelName: fixture[2],
        providerProtocol: fixture[3] === 'all' ? 'openai-completions' : fixture[3],
        providerRequestId: null,
        url: '',
        status: request.status,
        httpStatus: request.failed ? 504 : 200,
        retryable: request.failed,
        attemptIndex: 0,
        errorCode: request.failed ? 'UPSTREAM_TIMEOUT' : null,
        errorMessage: request.failed ? '开发示例：上游请求超时' : null,
        details: null,
        durationMilliseconds: request.totalDurationMilliseconds,
        createdTime: request.createdTime,
      }
    })).run()
  })

  return hasMissingFixtures
}
