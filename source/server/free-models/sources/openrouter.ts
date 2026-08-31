import { coreNetworkClient } from '@server/infrastructure/network/core-network'
import { createAuthHeaders } from '@server/proxy/upstream/auth'
import type { FreeModelFetchContext, FreeModelListing, FreeModelSource } from '../types'

const MODELS_URL = 'https://openrouter.ai/api/v1/models'

interface OpenRouterModelEntry {
  id?: unknown
  name?: unknown
  pricing?: {
    prompt?: unknown
    completion?: unknown
  }
}

/** 判断 OpenRouter 模型是否免费：prompt 与 completion 单价均为 0 */
export function isFreeModel(entry: OpenRouterModelEntry): boolean {
  const prompt = entry.pricing?.prompt
  const completion = entry.pricing?.completion
  const isZero = (value: unknown): boolean => {
    if (typeof value === 'number') return value === 0
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) && parsed === 0
    }
    return false
  }
  return isZero(prompt) && isZero(completion)
}

async function fetchOpenRouterFreeModels(context: FreeModelFetchContext): Promise<FreeModelListing[]> {
  const url = new URL(MODELS_URL)
  const response = await coreNetworkClient.requestHttpBuffered(url, {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      ...createAuthHeaders('openai-completions', context.apiKey, null),
      Accept: 'application/json',
    },
    timeout: context.timeoutMilliseconds,
    signal: context.signal,
  }, Buffer.alloc(0))

  if (response.statusCode < 200 || response.statusCode >= 300) {
    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new Error('OpenRouter 拒绝了认证，请检查 API Key 是否正确')
    }
    throw new Error(`OpenRouter 模型列表请求失败（HTTP ${response.statusCode}）`)
  }

  let json: unknown
  try {
    json = JSON.parse(response.body)
  } catch {
    throw new Error('OpenRouter 返回了无法解析的模型列表')
  }
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new Error('OpenRouter 模型列表响应格式不正确')

  const models: FreeModelListing[] = []
  for (const item of data as OpenRouterModelEntry[]) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    if (!isFreeModel(item)) continue
    models.push({ id: item.id.trim(), name: typeof item.name === 'string' ? item.name : undefined })
  }
  return models
}

export const openRouterFreeSource: FreeModelSource = {
  key: 'openrouter-free',
  name: 'OpenRouter 免费模型',
  description: '自动同步 OpenRouter 上当前完全免费的模型（:free 及零定价模型），免费模型变动时自动增删。',
  presetKey: 'openrouter',
  providerName: 'OpenRouter 免费',
  requiresApiKey: false,
  apiKeyPlaceholder: 'sk-or-...（可留空，填写后限额更高）',
  apiKeyHelpText: '在 openrouter.ai 创建 API Key；免费模型不填 Key 也可使用，填写后可获得更高限额。',
  endpoints: {
    'openai-completions': 'https://openrouter.ai/api/v1/chat/completions',
  },
  fetchFreeModels: fetchOpenRouterFreeModels,
}
