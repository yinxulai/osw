import { listBindingsByModel, getProvider } from '../database/store'
import { isProviderAvailable } from './health'
import type { ModelBinding, Provider, Protocol } from '@common/schemas'

export interface BindingWithProvider {
  binding: ModelBinding
  provider: Provider
}

/**
 * 获取指定逻辑模型的可用 binding 列表，按优先级排序，过滤掉冷却中的 provider
 */
export async function getAvailableBindings(logicalModelId: string): Promise<BindingWithProvider[]> {
  const bindings = await listBindingsByModel(logicalModelId)

  const result: BindingWithProvider[] = []

  for (const binding of bindings) {
    if (!binding.enabled) continue

    const provider = await getProvider(binding.providerId)
    if (!provider || !provider.enabled || provider.deletedTime !== null) continue

    if (!await isProviderAvailable(provider.id)) continue

    result.push({ binding, provider })
  }

  return result
}

/**
 * 从请求路径中检测协议类型
 */
export function detectProtocolFromPath(pathname: string): Protocol | null {
  const path = pathname.split('?', 1)[0]

  if (path === '/v1/completions') return 'openai-completions'
  if (path === '/v1/responses') return 'openai-responses'
  if (path === '/v1/messages') return 'anthropic-messages'

  return null
}
