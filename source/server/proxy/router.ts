import { listBindingsByModel, getProvider } from '../db/store'
import { isProviderAvailable } from '../health'
import type { ModelBinding, Provider, Protocol } from '@common/schemas'

export interface BindingWithProvider {
  binding: ModelBinding
  provider: Provider
}

const OPENAI_PATHS = new Set([
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/embeddings',
  '/v1/responses',
])

const GEMINI_PATH_PATTERN = /^\/v1beta\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/

/**
 * 获取指定逻辑模型的可用 binding 列表，按优先级排序，过滤掉冷却中的 provider
 */
export function getAvailableBindings(logicalModelId: string): BindingWithProvider[] {
  const bindings = listBindingsByModel(logicalModelId)

  const result: BindingWithProvider[] = []

  for (const binding of bindings) {
    if (!binding.enabled) continue

    const provider = getProvider(binding.providerId)
    if (!provider || !provider.enabled || provider.deletedTime !== null) continue

    if (!isProviderAvailable(provider.id)) continue

    result.push({ binding, provider })
  }

  return result
}

/**
 * 从请求路径中检测协议类型
 */
export function detectProtocolFromPath(pathname: string): Protocol | null {
  const path = pathname.split('?', 1)[0]

  if (path === '/v1/messages') return 'anthropic'
  if (OPENAI_PATHS.has(path)) return 'openai'
  if (GEMINI_PATH_PATTERN.test(path)) return 'gemini'

  return null
}
