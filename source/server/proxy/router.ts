import { listBindingsByModel, getProvider } from '../db/store'
import { isProviderAvailable } from '../health'
import type { ModelBinding, Provider, Protocol } from '@common/schemas'

export interface BindingWithProvider {
  binding: ModelBinding
  provider: Provider
}

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
  if (pathname.startsWith('/v1/')) return 'openai'
  // TODO: Anthropic / Gemini 更精确的检测
  return null
}
