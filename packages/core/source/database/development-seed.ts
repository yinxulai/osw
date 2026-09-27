import type { SecretStore } from '@common/secret-store'
import { and, eq, inArray } from 'drizzle-orm'
import { getConfigDb, getDataDb } from './index'
import {
  providerEndpoints,
  providerModelEndpoints,
  providerModels,
  providerSettings,
  providers,
  schedulingPolicies,
} from './config-schema'
import {
  attemptContents,
  attemptUsages,
  providerHealth,
  providerModelHealth,
  requestAttempts,
  requestContents,
  requestLogs,
  requestUsages,
} from './data-schema'

const PROVIDER_FIXTURES = [
  {
    id: 'prov_dev_openai',
    name: 'OpenAI',
    legacyName: 'OpenAI（开发示例）',
    apiKeyReference: 'key_dev_openai',
    apiKey: 'sk-development-openai',
    endpoints: {
      'openai-completions': 'https://api.openai.com/v1/chat/completions',
      'openai-responses': 'https://api.openai.com/v1/responses',
    },
  },
  {
    id: 'prov_dev_anthropic',
    name: 'Anthropic',
    legacyName: 'Anthropic（开发示例）',
    apiKeyReference: 'key_dev_anthropic',
    apiKey: 'sk-development-anthropic',
    endpoints: {
      'anthropic-messages': 'https://api.anthropic.com/v1/messages',
    },
  },
  {
    id: 'prov_dev_ark',
    name: 'Volcengine Ark',
    // `legacyName` 用于按 id 就地重命名：库里同一 id 的行可能仍带着这个名字，
    // 匹配得上才能就地升级，否则会多出一行。
    legacyName: '火山方舟（开发示例）',
    apiKeyReference: 'key_dev_ark',
    apiKey: 'development-ark-key',
    endpoints: {
      'openai-completions': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      'openai-responses': 'https://ark.cn-beijing.volces.com/api/v3/responses',
    },
  },
  {
    id: 'prov_dev_deepseek',
    name: 'DeepSeek',
    legacyName: 'DeepSeek（开发示例）',
    apiKeyReference: 'key_dev_deepseek',
    apiKey: 'sk-development-deepseek',
    endpoints: {
      'openai-completions': 'https://api.deepseek.com/chat/completions',
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
] as const

const DEVELOPMENT_REQUEST_COUNT = 120

interface DevelopmentSeedOptions {
  allowExisting?: boolean
}

export async function seedDevelopmentData(secretStore: SecretStore, options: DevelopmentSeedOptions = {}): Promise<boolean> {
  const config = getConfigDb()
  const data = getDataDb()
  // 注意：logical_models 不参与判断 —— 初始化时会自动创建 default 逻辑模型，不代表用户已有配置
  // 「有没有配置」要两边一起看：只配了供应商算配置，只留下请求记录也算。
  const hasConfiguration = Boolean(
    config.select({ id: providers.id }).from(providers).limit(1).get()
    || data.select({ id: requestLogs.id }).from(requestLogs).limit(1).get(),
  )
  if (hasConfiguration && !options.allowExisting) return false

  const fixtureProviderIds = PROVIDER_FIXTURES.map(provider => provider.id)
  const fixtureProviderModelIds = PROVIDER_MODEL_FIXTURES.map((_, index) => `model_dev_provider_${index + 1}`)
  const existingProviderIds = new Set(
    config.select({ id: providers.id }).from(providers).where(inArray(providers.id, fixtureProviderIds)).all().map(row => row.id),
  )
  const existingHealthProviderIds = new Set(
    data.select({ id: providerHealth.providerId }).from(providerHealth).where(inArray(providerHealth.providerId, fixtureProviderIds)).all().map(row => row.id),
  )
  const existingProviderModelIds = new Set(
    config.select({ id: providerModels.id }).from(providerModels).where(inArray(providerModels.id, fixtureProviderModelIds)).all().map(row => row.id),
  )

  for (const provider of PROVIDER_FIXTURES) {
    if (!existingProviderIds.has(provider.id)) await secretStore.set(provider.apiKeyReference, provider.apiKey)
  }

  const timestamp = Date.now()
  const batchId = `${timestamp.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const providerModelsToInsert = PROVIDER_MODEL_FIXTURES.map((fixture, index) => ({ fixture, index })).filter(({ index }) => !existingProviderModelIds.has(`model_dev_provider_${index + 1}`))

  // 两个库、两个事务：SQLite 的事务不能跨文件，配置先写一次、观测数据再写一次。
  config.transaction(transaction => {
    const providersToInsert = PROVIDER_FIXTURES.filter(provider => !existingProviderIds.has(provider.id))
    if (providersToInsert.length > 0) transaction.insert(providers).values(providersToInsert.map(provider => ({
      id: provider.id,
      name: provider.name,
      description: 'Development sample provider',
      enabled: true,
      // 种子行的侧栏顺序照 fixture 数组来：`createdTime` 全都一样，没有序号就没有确定顺序。
      sortOrder: PROVIDER_FIXTURES.indexOf(provider),
      createdTime: timestamp,
      updatedTime: timestamp,
    }))).run()
    for (const provider of PROVIDER_FIXTURES.filter(provider => existingProviderIds.has(provider.id))) {
      transaction.update(providers)
        .set({ name: provider.name, updatedTime: timestamp })
        .where(and(eq(providers.id, provider.id), eq(providers.name, provider.legacyName)))
        .run()
    }
    if (providersToInsert.length > 0) transaction.insert(providerSettings).values(providersToInsert.flatMap(provider => [
      { providerId: provider.id, key: 'security.secretReference', value: provider.apiKeyReference, valueType: 'string', updatedTime: timestamp },
      { providerId: provider.id, key: 'connection.timeoutMilliseconds', value: '30000', valueType: 'number', updatedTime: timestamp },
    ])).run()

    if (providerModelsToInsert.length > 0) {
      transaction.insert(providerModels).values(providerModelsToInsert.map(({ fixture, index }) => ({
        id: `model_dev_provider_${index + 1}`,
        providerId: fixture[1],
        modelName: fixture[2],
        enabled: true,
        createdTime: timestamp,
        updatedTime: timestamp,
      }))).run()

      for (const { fixture, index } of providerModelsToInsert) {
        const protocols = [fixture[3]]
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
  })

  data.transaction(transaction => {
    // 供应商改名时，历史尝试里冗余存着的名字要跟着走：那是同一件事的两份落库位置。
    for (const provider of PROVIDER_FIXTURES.filter(provider => existingProviderIds.has(provider.id))) {
      transaction.update(requestAttempts)
        .set({ providerName: provider.name })
        .where(and(eq(requestAttempts.providerId, provider.id), eq(requestAttempts.providerName, provider.legacyName)))
        .run()
    }

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
    if (providerModelsToInsert.length > 0) {
      transaction.insert(providerModelHealth).values(providerModelsToInsert.map(({ index }) => ({ providerModelId: `model_dev_provider_${index + 1}`, updatedTime: timestamp }))).run()
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
        ttftMilliseconds: failed ? null : 110 + (index * 31) % 420,
        // 客户端跳声明的形态：请求体里就有这个事实。
        transport: index % 4 === 0 ? 'http-stream' as const : 'http' as const,
        createdTime: timestamp - index * 6 * 3_600_000,
        provider,
        index,
        failed,
      }
    })

    transaction.insert(requestLogs).values(sampleRequests.map(request => ({
      id: request.id,
      logicalModelId: request.logicalModelId,
      clientProtocol: request.protocol,
      transport: request.transport,
      status: request.status,
      totalDurationMilliseconds: request.totalDurationMilliseconds,
      createdTime: request.createdTime,
    }))).run()
    const usages: Array<typeof requestUsages.$inferInsert> = sampleRequests.flatMap(request => request.totalTokens == null ? [] : [
      { requestId: request.id, type: 'inputTokens', value: request.inputTokens!, createdTime: request.createdTime },
      { requestId: request.id, type: 'outputTokens', value: request.outputTokens!, createdTime: request.createdTime },
      { requestId: request.id, type: 'cachedInputTokens', value: request.cachedInputTokens!, createdTime: request.createdTime },
      ...(request.index % 4 === 0 ? [{ requestId: request.id, type: 'cacheCreationInputTokens', value: request.cacheCreationInputTokens!, createdTime: request.createdTime }] : []),
      // 原始 usage 报文没有数值，作为 `raw` 类型的行与其他用量并存。
      {
        requestId: request.id,
        type: 'raw',
        value: null,
        rawValue: JSON.stringify({ prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens, prompt_tokens_details: { cached_tokens: request.cachedInputTokens } }),
        createdTime: request.createdTime,
      },
    ])
    if (usages.length > 0) transaction.insert(requestUsages).values(usages).run()
    transaction.insert(requestAttempts).values(sampleRequests.flatMap(request => {
      const fixture = PROVIDER_MODEL_FIXTURES[request.index % PROVIDER_MODEL_FIXTURES.length]
      const providerModelId = `model_dev_provider_${request.index % PROVIDER_MODEL_FIXTURES.length + 1}`
      // 开发示例：客户端跳要增量时，上游跳也以 SSE 返回（忠诚转发的典型情形）。
      const upstreamTransport = request.transport === 'http-stream' ? 'http-stream' as const : 'http' as const
      const attempt = {
        id: `att_dev_${request.id}`,
        requestId: request.id,
        providerId: request.provider.id,
        providerModelId,
        providerName: request.provider.name,
        providerModelName: fixture[2],
        upstreamProtocol: fixture[3],
        upstreamRequestId: null,
        url: '',
        status: request.status,
        httpStatus: request.failed ? 504 : 200,
        retryable: request.failed,
        attemptIndex: 0,
        // 上游跳实际是什么形态。本行最终失败的尝试根本没等到响应，因此无从判断。
        upstreamTransport: request.failed ? null : upstreamTransport,
        errorCode: request.failed ? 'UPSTREAM_TIMEOUT' : null,
        errorMessage: request.failed ? 'Development sample: upstream request timed out' : null,
        durationMilliseconds: request.totalDurationMilliseconds,
        ttftMilliseconds: request.ttftMilliseconds,
        // 事实总是写入，与是否采集正文无关。
        requestRewriteRuleIds: JSON.stringify([]),
        responseRewriteRuleIds: JSON.stringify([]),
        createdTime: request.createdTime,
      }
      if (!request.failed) return [attempt]
      return [
        { ...attempt, id: `att_dev_${request.id}_retry`, status: 'success', httpStatus: 200, retryable: false, attemptIndex: 1, upstreamTransport, errorCode: null, errorMessage: null, durationMilliseconds: request.totalDurationMilliseconds + 640 },
        { ...attempt, attemptIndex: 0 },
      ]
    })).run()
    // 尝试级用量：归属由 attemptId 唯一确定，请求级用量在另一张表里。
    const attemptUsageRows: Array<typeof attemptUsages.$inferInsert> = sampleRequests.flatMap(request => request.totalTokens == null ? [] : [
      { attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`, type: 'inputTokens', value: request.inputTokens!, createdTime: request.createdTime },
      { attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`, type: 'outputTokens', value: request.outputTokens!, createdTime: request.createdTime },
      { attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`, type: 'cachedInputTokens', value: request.cachedInputTokens!, createdTime: request.createdTime },
      {
        attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`,
        type: 'raw',
        value: null,
        rawValue: JSON.stringify({ prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens }),
        createdTime: request.createdTime,
      },
    ])
    if (attemptUsageRows.length > 0) transaction.insert(attemptUsages).values(attemptUsageRows).run()
    transaction.insert(requestContents).values(sampleRequests.flatMap(request => {
      const responseBody = request.failed
        ? JSON.stringify({ error: { type: 'upstream_timeout', message: 'Development sample: upstream request timed out' } })
        : JSON.stringify({ id: `chatcmpl-dev-${request.id}`, object: 'chat.completion', model: request.provider.name, choices: [{ index: 0, message: { role: 'assistant', content: 'This is a sample response generated by the development seeder.' }, finish_reason: 'stop' }], usage: { prompt_tokens: request.inputTokens, completion_tokens: request.outputTokens, total_tokens: request.totalTokens } })
      const requestBody = JSON.stringify({ model: request.provider.name, messages: [{ role: 'user', content: request.index % 3 === 0 ? 'Summarize this development sample content.' : 'Write a short development sample reply.' }], temperature: request.index % 2 === 0 ? 0.7 : 0.2, stream: request.index % 4 === 0 })
      const captureStatus = request.failed
        ? 'partial'
        : request.index % 11 === 0
          ? 'partial'
          : request.index % 7 === 0
            ? 'partial'
            : 'captured'
      // 客户端视角：每个请求一行，只描述客户端看到的内容。
      return [{
        id: `content_dev_${request.id}`,
        requestId: request.id,
        captureStatus,
        requestMethod: 'POST',
        requestPath: request.protocol === 'anthropic-messages' ? '/v1/messages' : '/v1/chat/completions',
        requestHeaders: JSON.stringify({ 'content-type': 'application/json', authorization: '[REDACTED]', 'x-development-batch': request.index % 2 === 0 ? 'standard' : 'extended' }),
        requestBody,
        responseStatus: request.failed ? 504 : 200,
        responseHeaders: JSON.stringify({ 'content-type': 'application/json', 'x-request-id': `req-${request.id}` }),
        responseBody,
        createdTime: request.createdTime,
        updatedTime: request.createdTime,
      }]
    }).flat()).run()
    transaction.insert(attemptContents).values(sampleRequests.filter(request => request.index % 4 === 0).map(request => ({
      // 上游视角：每次尝试一行，只描述真正发给供应商 / 由供应商返回的内容。
      id: `attempt_content_dev_${request.id}`,
      attemptId: `att_dev_${request.id}${request.failed ? '_retry' : ''}`,
      captureStatus: request.failed ? 'captured' : 'partial',
      requestHeaders: JSON.stringify({ 'content-type': 'application/json', authorization: '[REDACTED]', 'x-upstream-attempt': 'development-seed' }),
      requestBody: JSON.stringify({ model: request.provider.name, messages: [{ role: 'user', content: 'This is an attempt-level request body.' }], stream: true }),
      responseStatus: request.failed ? 504 : 200,
      responseHeaders: JSON.stringify({ 'content-type': 'application/json', 'x-upstream-request-id': `upstream-${request.id}` }),
      responseBody: JSON.stringify({ id: `attempt-${request.id}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'This is an attempt-level response.' } }] }),
      createdTime: request.createdTime,
      updatedTime: request.createdTime,
    }))).run()
  })

  return true
}
