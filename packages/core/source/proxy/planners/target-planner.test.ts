import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Protocol } from '@common/schemas'
import type { PlanResult } from '@server/proxy/contracts'
import type * as RouterModule from '@server/proxy/routing/router'
import type { ModelWithProvider } from '@server/proxy/routing/router'

const mocks = vi.hoisted(() => ({
  models: [] as ModelWithProvider[],
  batchCalls: [] as Array<Array<{ logicalModelId: string; manualModelId: string | null }>>,
  affinityCalls: [] as Array<string | null | undefined>,
  settings: { cacheAffinityEnabled: false, cacheAffinityTtlSeconds: 900 },
}))

const settingsStore = vi.hoisted(() => ({
  getSettings: vi.fn(),
}))

interface ManualModelOptions {
  manualModelId?: string | null
  affinityProviderModelId?: string | null
}

type BatchPlannerInput = { logicalModelId: string; manualModelId: string | null }

vi.mock('@server/database/settings-store', () => settingsStore)

// 只替换「谁能用」（需要数据库与健康冷却），端点匹配与协议转换矩阵用真实实现：
// 规划器要验证的正是「匹配结果如何变成一份目标」这段合成逻辑。
vi.mock('@server/proxy/routing/router', async importOriginal => {
  const original = await importOriginal<typeof RouterModule>()
  return {
    ...original,
    getAvailableModels: async (_logicalModelId: string, options: ManualModelOptions = {}) => {
      mocks.affinityCalls.push(options.affinityProviderModelId)
      return options.manualModelId
        ? mocks.models.filter(candidate => candidate.model.id === options.manualModelId)
        : mocks.models
    },
    getAvailableModelsBatch: async (inputs: BatchPlannerInput[]) => {
      mocks.batchCalls.push(inputs)
      return new Map(inputs.map(input => [
        input.logicalModelId,
        input.manualModelId
          ? mocks.models.filter(candidate => candidate.model.id === input.manualModelId)
          : mocks.models,
      ]))
    },
  }
})

import { buildUpstreamTarget, proxyTargetPlanner } from './target-planner'
import { clearAffinityStoreForTests, writeAffinityBinding } from '@server/proxy/upstream/affinity'

beforeEach(() => {
  settingsStore.getSettings.mockResolvedValue(mocks.settings)
})

afterEach(() => {
  mocks.models = []
  mocks.batchCalls = []
  mocks.affinityCalls = []
  clearAffinityStoreForTests()
})

interface EndpointFixture {
  protocol: Protocol
  url: string
  conversionEnabled?: boolean
  customAuthHeader?: string | null
}

function candidate(id: string, endpoints: EndpointFixture[], providerId = 'prov_alpha'): ModelWithProvider {
  const time = Date.now()
  return {
    model: {
      id,
      providerId,
      modelName: `${id}-upstream`,
      endpoints: endpoints.map(endpoint => ({
        protocol: endpoint.protocol,
        endpointUrl: endpoint.url,
        customAuthHeader: endpoint.customAuthHeader ?? null,
        protocolConversionEnabled: endpoint.conversionEnabled ?? false,
      })),
      priority: 1,
      enabled: true,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    },
    provider: {
      id: providerId,
      name: providerId,
      apiKeyReference: `${providerId}_key`,
      timeoutMilliseconds: 1_000,
      enabled: true,
      createdTime: time,
      updatedTime: time,
      deletedTime: null,
    },
  }
}

function plan(clientProtocol: Protocol, manualModelId: string | null = null, sessionKey?: string): Promise<PlanResult> {
  // 上游形态不在这里传：它由端点自己的地址决定（`wss://` 就是 websocket）。
  // 客户端跳的取值从不改变哪个端点合法。
  return Promise.resolve(proxyTargetPlanner.plan({ logicalModelId: 'default', clientProtocol, manualModelId, sessionKey }))
}

describe('端点匹配', () => {
  it('prefers the native endpoint over a convertible one', async () => {
    mocks.models = [candidate('model_alpha', [
      { protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions', conversionEnabled: true },
      { protocol: 'openai-responses', url: 'https://upstream.example.com/v1/responses' },
    ])]

    const result = await plan('openai-responses')

    expect(result.reason).toBe('none')
    expect(result.targets).toHaveLength(1)
    // 能原生说这个协议就用原生：转换是退路，不是优化。
    expect(result.targets[0]).toMatchObject({ protocol: 'openai-responses', url: 'https://upstream.example.com/v1/responses' })
  })

  it('accepts a convertible endpoint on http and keeps its protocol as the upstream protocol', async () => {
    mocks.models = [candidate('model_alpha', [
      { protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions', conversionEnabled: true },
    ])]

    const result = await plan('openai-responses')

    expect(result.targets).toHaveLength(1)
    // 目标说的是「我们实际连到哪儿」——上游协议是 completions，客户端协议由转换适配器负责。
    expect(result.targets[0]).toMatchObject({ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' })
  })

  it('rejects a convertible endpoint when conversion is off', async () => {
    mocks.models = [candidate('model_alpha', [
      { protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' },
    ])]

    const result = await plan('openai-responses')

    expect(result.targets).toHaveLength(0)
    expect(result.reason).toBe('no-available-provider')
    expect(result.detail).toContain('protocol conversion is disabled')
    expect(result.detail).toContain('configured protocols: openai-completions')
    expect(result.detail).toContain('prov_alpha/model_alpha-upstream')
  })

  it('never plans a convertible endpoint on a websocket endpoint', async () => {
    mocks.models = [candidate('model_alpha', [
      { protocol: 'openai-completions', url: 'wss://upstream.example.com/v1/chat/completions', conversionEnabled: true },
    ])]

    const result = await plan('openai-responses')

    // 双向长连接跨协议需要 WS ↔ HTTP 桥接，不在 P1 的范围内：只给原生候选，宁可拒绝。
    // 判据是**端点自己的地址**（`wss://`），不是客户端声明的传输形态。
    expect(result.targets).toHaveLength(0)
    expect(result.reason).toBe('no-available-provider')
    // 报错不能把原因说成「未开启协议转换」：转换是开的，拦住它的是形态。
    expect(result.detail).toContain('cross-shape conversion is out of scope')
  })

  it('never plans an endpoint that has no address', async () => {
    mocks.models = [candidate('model_alpha', [
      { protocol: 'openai-responses', url: '' },
    ])]

    const result = await plan('openai-responses')

    // 空地址是「这个协议还没填地址」（协议端点行的地址为空），不是「地址写错了」：
    // 交给传输层只会得到一次必然失败的尝试，没有任何重试或健康冷却能救，所以按未配置处理。
    expect(result.targets).toHaveLength(0)
    expect(result.reason).toBe('no-available-provider')
    // 也不能说成「没配这个协议」——它明明配了，只是没有地址。
    expect(result.detail).toContain('bind the openai-responses protocol but have no upstream url configured')
    expect(result.detail).toContain('prov_alpha/model_alpha-upstream')
  })
})

describe('候选为空时的原因', () => {
  it('reports model-not-configured when the logical model has no usable model', async () => {
    const result = await plan('openai-completions')

    expect(result.targets).toHaveLength(0)
    expect(result.reason).toBe('model-not-configured')
    expect(result.detail).toBe('This logical model has no enabled and healthy provider model')
  })

  it('reports manual-model-unavailable when the manually locked model is gone', async () => {
    mocks.models = [candidate('model_alpha', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }])]

    const result = await plan('openai-completions', 'model_missing')

    // 手动锁定的模型不可用绝不能退化成「没有可用供应商」：那会是一句与用户操作无关的报错。
    expect(result.reason).toBe('manual-model-unavailable')
    expect(result.detail).toBe('The manually selected ProviderModel is not available for this protocol')
  })

  it('reports manual-model-unavailable when the locked model cannot serve the protocol', async () => {
    mocks.models = [candidate('model_alpha', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }])]

    const result = await plan('anthropic-messages', 'model_alpha')

    expect(result.targets).toHaveLength(0)
    expect(result.reason).toBe('manual-model-unavailable')
  })
})

describe('批量规划', () => {
  it('queries every landing once and keeps the input order', async () => {
    mocks.models = [
      candidate('model_alpha', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }]),
    ]

    const results = await proxyTargetPlanner.planMany!([
      { logicalModelId: 'first', clientProtocol: 'openai-completions', manualModelId: null },
      { logicalModelId: 'second', clientProtocol: 'anthropic-messages', manualModelId: null },
    ])

    expect(mocks.batchCalls).toEqual([[
      { logicalModelId: 'first', manualModelId: null, affinityProviderModelId: null },
      { logicalModelId: 'second', manualModelId: null, affinityProviderModelId: null },
    ]])
    expect(results).toHaveLength(2)
    expect(results[0].targets).toHaveLength(1)
    expect(results[1]).toMatchObject({ targets: [], reason: 'no-available-provider' })
  })
})

describe('目标字段', () => {
  it('carries every fact a connection needs out of the candidate', async () => {
    mocks.models = [candidate('model_alpha', [
      { protocol: 'anthropic-messages', url: 'https://api.anthropic.com/v1/messages', customAuthHeader: 'x-api-key' },
    ])]

    const result = await plan('anthropic-messages')

    expect(result.targets[0]).toEqual({
      providerId: 'prov_alpha',
      providerName: 'prov_alpha',
      providerModelId: 'model_alpha',
      providerModelName: 'model_alpha-upstream',
      apiKeyReference: 'prov_alpha_key',
      customAuthHeader: 'x-api-key',
      endpointId: 'model_alpha:anthropic-messages',
      protocol: 'anthropic-messages',
      url: 'https://api.anthropic.com/v1/messages',
      timeoutMilliseconds: 1_000,
    })
  })

  it('keeps the user order of candidates', async () => {
    mocks.models = [
      candidate('model_first', [{ protocol: 'openai-completions', url: 'https://first.example.com/v1/chat/completions' }]),
      candidate('model_second', [{ protocol: 'openai-completions', url: 'https://second.example.com/v1/chat/completions' }]),
    ]

    const result = await plan('openai-completions')

    expect(result.targets.map(target => target.providerModelId)).toEqual(['model_first', 'model_second'])
  })

  it('passes a websocket url through untouched', async () => {
    mocks.models = [candidate('model_alpha', [{ protocol: 'openai-responses', url: 'wss://upstream.example.com/v1/responses' }])]

    const result = await plan('openai-responses')

    // 规划器不是校验器：非 http(s) 的地址属于传输层的事，原样下发。
    expect(result.targets[0].url).toBe('wss://upstream.example.com/v1/responses')
  })

  it('passes an unusable url through untouched instead of failing the whole plan', async () => {
    mocks.models = [
      candidate('model_broken', [{ protocol: 'openai-completions', url: 'not-a-url' }]),
      candidate('model_healthy', [{ protocol: 'openai-completions', url: 'https://healthy.example.com/v1/chat/completions' }]),
    ]

    const result = await plan('openai-completions')

    // 一个写错的地址只该让那一个候选失败，其他候选照旧可切。
    expect(result.targets).toHaveLength(2)
    expect(result.targets[0].url).toBe('not-a-url')
  })
})

describe('buildUpstreamTarget', () => {
  it('returns null when the candidate cannot serve the protocol', () => {
    const candidateModel = candidate('model_alpha', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }])

    expect(buildUpstreamTarget(candidateModel, 'openai-responses')).toBeNull()
  })

  it('builds a single target for callers that test one specific model', () => {
    const candidateModel = candidate('model_alpha', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }])

    expect(buildUpstreamTarget(candidateModel, 'openai-completions')).toMatchObject({
      providerModelId: 'model_alpha',
      endpointId: 'model_alpha:openai-completions',
    })
  })
})

describe('缓存亲和', () => {
  it('hands the session binding to the router when enabled', async () => {
    mocks.settings = { cacheAffinityEnabled: true, cacheAffinityTtlSeconds: 900 }
    settingsStore.getSettings.mockResolvedValue(mocks.settings)
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)
    mocks.models = [
      candidate('model_alpha', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }]),
      candidate('model_beta', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v2/chat/completions' }]),
    ]

    await plan('openai-completions', null, 'sess_alpha')

    // 规划器只负责解析绑定，排序在路由的健康分组处完成：这里验证的是「绑定被交下去」。
    expect(mocks.affinityCalls).toEqual(['model_alpha'])
  })

  it('resolves nothing when affinity is disabled', async () => {
    mocks.settings = { cacheAffinityEnabled: false, cacheAffinityTtlSeconds: 900 }
    settingsStore.getSettings.mockResolvedValue(mocks.settings)
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)
    mocks.models = [
      candidate('model_alpha', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }]),
    ]

    await plan('openai-completions', null, 'sess_alpha')

    expect(mocks.affinityCalls).toEqual([null])
  })

  it('does not resolve a binding under manual lock', async () => {
    mocks.settings = { cacheAffinityEnabled: true, cacheAffinityTtlSeconds: 900 }
    settingsStore.getSettings.mockResolvedValue(mocks.settings)
    writeAffinityBinding('default', 'sess_alpha', 'model_alpha', true, 900)
    mocks.models = [
      candidate('model_beta', [{ protocol: 'openai-completions', url: 'https://upstream.example.com/v1/chat/completions' }]),
    ]

    // 手动锁定优先于亲和：用户显式指定的模型不接受任何策略的改排。
    await plan('openai-completions', 'model_beta', 'sess_alpha')

    expect(mocks.affinityCalls).toEqual([null])
  })
})
