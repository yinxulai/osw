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
  requestContents,
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

const PROVIDER_MODEL_FIXTURES = [
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

const DEVELOPMENT_REQUEST_COUNT = 120

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
  const existingProviderModelIds = new Set(
    db.select({ id: providerModels.id }).from(providerModels).where(inArray(providerModels.id, PROVIDER_MODEL_FIXTURES.map((_, index) => `model_dev_provider_${index + 1}`))).all().map(row => row.id),
  )

  for (const provider of PROVIDER_FIXTURES) {
    if (!existingProviderIds.has(provider.id)) await secretStore.set(provider.apiKeyReference, provider.apiKey)
  }

  const timestamp = Date.now()
  const batchId = `${timestamp.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
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

    const providerModelsToInsert = PROVIDER_MODEL_FIXTURES.map((fixture, index) => ({ fixture, index })).filter(({ index }) => !existingProviderModelIds.has(`model_dev_provider_${index + 1}`))
    if (providerModelsToInsert.length > 0) {
      transaction.insert(providerModels).values(providerModelsToInsert.map(({ fixture, index }) => ({
        id: `model_dev_provider_${index + 1}`,
        providerId: fixture[1],
        modelName: fixture[2],
        enabled: true,
        createdTime: timestamp,
        updatedTime: timestamp,
      }))).run()
      transaction.insert(providerModelHealth).values(providerModelsToInsert.map(({ index }) => ({ providerModelId: `model_dev_provider_${index + 1}`, updatedTime: timestamp }))).run()
      for (const { fixture, index } of providerModelsToInsert) {
        const protocols = fixture[3] === 'all' ? ALL_PROTOCOLS : [fixture[3]]
        for (const protocol of protocols) {
          const endpointId = `endpoint_dev_${fixture[1]}_${protocol}`
          const url = PROVIDER_FIXTURES.find(provider => provider.id === fixture[1])?.endpoints[protocol as keyof typeof PROVIDER_FIXTURES[number]['endpoints']] ?? 'https://api.example.com'
          const existingEndpoint = transaction.select().from(providerEndpoints).where(inArray(providerEndpoints.id, [endpointId])).get()
          if (!existingEndpoint) transaction.insert(providerEndpoints).values({ id: endpointId, providerId: fixture[1], protocol, url, enabled: true, createdTime: timestamp, updatedTime: timestamp }).run()
          transaction.insert(providerModelEndpoints).values({ id: `binding_dev_${index}_${protocol}`, providerModelId: `model_dev_provider_${index + 1}`, providerEndpointId: endpointId, url: null, enabled: true, createdTime: timestamp, updatedTime: timestamp }).run()
        }
        transaction.insert(schedulingPolicies).values({ logicalModelId: fixture[0], providerModelId: `model_dev_provider_${index + 1}`, priority: fixture[4], weight: 100, enabled: true, createdTime: timestamp, updatedTime: timestamp }).run()
      }
    }

    const sampleRequests = Array.from({ length: DEVELOPMENT_REQUEST_COUNT }, (_, index) => {
      const failed = index % 11 === 4
      const provider = PROVIDER_FIXTURES[index % PROVIDER_FIXTURES.length]
      const duration = 480 + (index * 173) % 2_400
      const inputTokens = 320 + index * 47
      const outputTokens = 80 + (index * 29) % 360
      return {
        id: `req_dev_${batchId}_${String(index + 1).padStart(2, '0')}`,
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
        createdTime: timestamp - index * 6 * 3_600_000,
        provider,
        index,
        failed,
      }
    })

    transaction.insert(requestLogs).values(sampleRequests.map(request => ({
      id: request.id,
      logicalModelId: request.logicalModelId,
      protocol: request.protocol,
      status: request.status,
      metadata: JSON.stringify({ source: 'development-seed', batchId, requestIndex: request.index, stream: false, temperature: 0.7 }),
      createdTime: request.createdTime,
    }))).run()
    transaction.insert(requestMetrics).values(sampleRequests.flatMap(request => [
      { requestId: request.id, key: 'durationMilliseconds', value: request.totalDurationMilliseconds, unit: 'milliseconds', updatedTime: timestamp },
      { requestId: request.id, key: 'ttftMilliseconds', value: request.ttftMilliseconds ?? request.totalDurationMilliseconds, unit: 'milliseconds', updatedTime: timestamp },
      { requestId: request.id, key: 'httpStatus', value: request.failed ? 504 : 200, unit: 'status', updatedTime: timestamp },
      { requestId: request.id, key: 'cacheHit', value: request.cacheHit ? 1 : 0, unit: 'boolean', updatedTime: timestamp },
    ])).run()
    const usages: Array<typeof requestUsages.$inferInsert> = sampleRequests.flatMap(request => request.totalTokens == null ? [] : [
      { id: `usage_dev_${request.id}_input`, requestId: request.id, attemptId: null, type: 'inputTokens', value: request.inputTokens!, unit: 'tokens', createdTime: request.createdTime },
      { id: `usage_dev_${request.id}_output`, requestId: request.id, attemptId: null, type: 'outputTokens', value: request.outputTokens!, unit: 'tokens', createdTime: request.createdTime },
      { id: `usage_dev_${request.id}_cached`, requestId: request.id, attemptId: null, type: 'cachedInputTokens', value: request.cachedInputTokens!, unit: 'tokens', createdTime: request.createdTime },
      ...(request.index % 4 === 0 ? [{ id: `usage_dev_${request.id}_cache_creation`, requestId: request.id, attemptId: null, type: 'cacheCreationInputTokens', value: request.cacheCreationInputTokens!, unit: 'tokens', createdTime: request.createdTime }] : []),
      { id: `usage_dev_${request.id}_total`, requestId: request.id, attemptId: null, type: 'totalTokens', value: request.totalTokens!, unit: 'tokens', createdTime: request.createdTime },
      { id: `usage_dev_${request.id}_cost`, requestId: request.id, attemptId: null, type: 'estimatedCost', value: Number((request.totalTokens * (request.index % 3 === 0 ? 0.000003 : 0.000002)).toFixed(6)), unit: 'USD', rawValue: JSON.stringify({ currency: 'USD', source: 'development-seed' }), createdTime: request.createdTime },
      { id: `usage_dev_${request.id}_raw`, requestId: request.id, attemptId: null, type: 'raw', value: 0, unit: 'string', rawValue: JSON.stringify({ prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens, prompt_tokens_details: { cached_tokens: request.cachedInputTokens } }), createdTime: request.createdTime },
    ])
    if (usages.length > 0) transaction.insert(requestUsages).values(usages).run()
    transaction.insert(requestAttempts).values(sampleRequests.flatMap(request => {
      const fixture = PROVIDER_MODEL_FIXTURES[request.index % PROVIDER_MODEL_FIXTURES.length]
      const providerModelId = `model_dev_provider_${request.index % PROVIDER_MODEL_FIXTURES.length + 1}`
      const attempt = {
        id: `att_dev_${request.id}`,
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
      if (!request.failed) return [attempt]
      return [
        { ...attempt, id: `att_dev_${request.id}_retry`, status: 'success', httpStatus: 200, retryable: false, attemptIndex: 1, errorCode: null, errorMessage: null, durationMilliseconds: request.totalDurationMilliseconds + 640 },
        { ...attempt, attemptIndex: 0 },
      ]
    })).run()
    transaction.insert(requestContents).values(sampleRequests.flatMap(request => {
      const responseBody = request.failed
        ? JSON.stringify({ error: { type: 'upstream_timeout', message: '开发示例：上游请求超时' } })
        : JSON.stringify({ id: `chatcmpl-dev-${request.id}`, object: 'chat.completion', model: request.provider.name, choices: [{ index: 0, message: { role: 'assistant', content: '这是开发环境生成的示例响应。' }, finish_reason: 'stop' }], usage: { prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens } })
      const requestContent = {
        id: `content_dev_${request.id}`,
        requestId: request.id,
        attemptId: null,
        captureStatus: request.failed ? 'partial' : request.index % 7 === 0 ? 'headers-only' : request.index % 5 === 0 ? 'truncated' : 'captured',
        requestMethod: 'POST',
        requestPath: request.protocol === 'anthropic-messages' ? '/v1/messages' : '/v1/chat/completions',
        requestHeaders: JSON.stringify({ 'content-type': 'application/json', authorization: '[REDACTED]', 'x-development-batch': request.index % 2 === 0 ? 'standard' : 'extended' }),
        requestBody: JSON.stringify({ model: request.provider.name, messages: [{ role: 'user', content: request.index % 3 === 0 ? '请总结这段开发环境示例内容。' : '请生成一段开发环境示例回复。' }], temperature: request.index % 2 === 0 ? 0.7 : 0.2, stream: request.index % 4 === 0 }),
        responseStatus: request.failed ? 504 : 200,
        responseHeaders: JSON.stringify({ 'content-type': 'application/json', 'x-request-id': `req-${request.id}` }),
        responseBody,
        conversions: request.protocol === 'anthropic-messages' ? JSON.stringify([{ direction: 'request', from: 'anthropic-messages', to: 'openai-completions' }, { direction: 'response', from: 'openai-completions', to: 'anthropic-messages' }]) : null,
        createdTime: request.createdTime,
        updatedTime: request.createdTime,
      }
      const attemptContents = request.index % 4 === 0
        ? [{ ...requestContent, id: `content_dev_${request.id}_attempt`, attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`, captureStatus: request.failed ? 'captured' : 'partial', requestBody: JSON.stringify({ model: request.provider.name, messages: [{ role: 'user', content: '这是上游 attempt 级请求正文。' }], stream: true }), responseBody: JSON.stringify({ id: `attempt-${request.id}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '这是 attempt 级响应。' } }] }) }]
        : []
      return [requestContent, ...attemptContents]
    }).flat()).run()
  })

  return true
}
