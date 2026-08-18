import { listUpstreamModelsByLogicalModel, getProvider } from '../database/store'
import { isProviderAvailable } from './health'
import type { UpstreamModel, Provider, Protocol } from '@common/schemas'

export interface ModelWithProvider {
  model: UpstreamModel
  provider: Provider
}

/**
 * 获取指定逻辑模型的可用 upstream model 列表，按优先级排序，过滤掉冷却中的 provider
 */
export async function getAvailableModels(logicalModelId: string): Promise<ModelWithProvider[]> {
  const models = await listUpstreamModelsByLogicalModel(logicalModelId)

  const result: ModelWithProvider[] = []

  for (const model of models) {
    if (!model.enabled) continue

    const provider = await getProvider(model.providerId)
    if (!provider || !provider.enabled || provider.deletedTime !== null) continue

    if (!await isProviderAvailable(provider.id)) continue

    result.push({ model, provider })
  }

  return result
}

/**
 * 从模型端点列表中查找指定协议的端点
 */
export function findEndpoint(model: UpstreamModel, protocol: Protocol) {
  return model.endpoints.find(endpoint => endpoint.protocol === protocol)
}

/**
 * 从请求路径中检测协议类型
 */
export function detectProtocolFromPath(pathname: string): Protocol | null {
  const rawPath = pathname.split('?', 1)[0]
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath

  if (path === '/v1/chat/completions' || path === '/chat/completions') {
    return 'openai-completions'
  }
  if (path === '/v1/completions' || path === '/completions') return 'openai-completions'
  if (path === '/v1/embeddings' || path === '/embeddings') return 'openai-completions'
  if (path === '/v1/responses' || path === '/responses') return 'openai-responses'
  if (path === '/v1/messages' || path === '/messages') return 'anthropic-messages'

  return null
}
