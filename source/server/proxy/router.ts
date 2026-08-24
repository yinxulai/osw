import { listProviderModelsForLogicalModel } from '../database/model-store'
import { getProvider } from '../database/provider-store'
import { isProviderAvailable, isProviderModelAvailable } from './health'
import { isConvertible } from '@common/protocols'
import type { ProviderModelRoute, Provider, Protocol } from '@common/schemas'

export interface ModelWithProvider {
  model: ProviderModelRoute
  provider: Provider
}

export interface AvailableModelsOptions {
  /** 手动模式精确指定的模型；忽略模型、供应商及健康状态。 */
  manualModelId?: string | null
}

/**
 * 获取逻辑模型绑定的 ProviderModel 列表，按数据库返回的队列顺序排列。
 * 自动模式只调度已启用且健康的模型；若健康模型为零，则返回全部已启用模型
 * 逐个探测。手动模式只返回指定模型，不受启用状态或健康冷却影响。
 */
export async function getAvailableModels(logicalModelId = 'default', options: AvailableModelsOptions = {}): Promise<ModelWithProvider[]> {
  const manualModelId = options.manualModelId ?? null
  const models = await listProviderModelsForLogicalModel(logicalModelId, false, manualModelId !== null)

  const allModels: ModelWithProvider[] = []
  const availableModels: ModelWithProvider[] = []

  for (const model of models) {
    if (manualModelId !== null && model.id !== manualModelId) continue
    if (manualModelId === null && !model.enabled) continue

    const provider = await getProvider(model.providerId)
    if (!provider || provider.deletedTime !== null) continue

    const candidate = { model, provider }
    if (manualModelId !== null) return [candidate]
    if (!provider.enabled) continue
    allModels.push(candidate)

    if (!await isProviderAvailable(provider.id)) continue
    if (!await isProviderModelAvailable(model.id)) continue
    availableModels.push(candidate)
  }

  return availableModels.length > 0 ? availableModels : allModels
}

/**
 * 从模型端点列表中查找指定协议的端点
 */
export function findEndpoint(model: ProviderModelRoute, protocol: Protocol) {
  return model.endpoints.find(endpoint => endpoint.protocol === protocol)
}

/**
 * 查找可接收 clientProtocol 请求（经协议转换）的端点。
 * 仅返回显式开启 protocolConversionEnabled 的端点。
 */
export function findConvertibleEndpoint(model: ProviderModelRoute, clientProtocol: Protocol) {
  return model.endpoints.find(
    endpoint => endpoint.protocolConversionEnabled === true && isConvertible(endpoint.protocol, clientProtocol),
  )
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
