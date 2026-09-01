import { listProviderModelsForLogicalModel } from '@server/database/model-store'
import { getProvider } from '@server/database/provider-store'
import { isConvertible } from '@common/protocols'
import type { ProviderModelRoute, Provider, Protocol } from '@common/schemas'
import { HttpRouter } from '@server/http-router'
import { isProviderAvailable, isProviderModelAvailable } from '@server/proxy/upstream/health'
import { registerOpenAiCompletionsRoutes } from '@server/proxy/protocols/openai-completions/routes'
import { registerOpenAiResponsesRoutes } from '@server/proxy/protocols/openai-responses/routes'
import { registerAnthropicMessagesRoutes } from '@server/proxy/protocols/anthropic-messages/routes'

export interface ModelWithProvider {
  model: ProviderModelRoute
  provider: Provider
}

export interface AvailableModelsOptions {
  /** 手动模式精确指定的模型；忽略模型、供应商及健康状态�?*/
  manualModelId?: string | null
}

/**
 * 获取逻辑模型绑定?ProviderModel 列表，按数据库返回的队列顺序排列�?
 * 自动模式保持用户指定的原始顺序：可用模型排在前面，不可用模型整体后移；
 * 两个分组内部都保持用户设置的先后级别。
 * 手动模式只返回指定模型，不受启用状态或健康冷却影响�?
 */
export async function getAvailableModels(logicalModelId = 'default', options: AvailableModelsOptions = {}): Promise<ModelWithProvider[]> {
  const manualModelId = options.manualModelId ?? null
  const models = await listProviderModelsForLogicalModel(logicalModelId, false, manualModelId !== null)

  const availableModels: ModelWithProvider[] = []
  const unavailableModels: ModelWithProvider[] = []

  for (const model of models) {
    if (manualModelId !== null && model.id !== manualModelId) continue
    if (manualModelId === null && !model.enabled) continue

    const provider = await getProvider(model.providerId)
    if (!provider || provider.deletedTime !== null) continue

    const candidate = { model, provider }
    if (manualModelId !== null) return [candidate]
    if (!provider.enabled) continue

    const healthy = await isProviderAvailable(provider.id) && await isProviderModelAvailable(model.id)
    if (healthy) availableModels.push(candidate)
    else unavailableModels.push(candidate)
  }

  return [...availableModels, ...unavailableModels]
}

/**
 * 从模型端点列表中查找指定协议的端�?
 */
export function findEndpoint(model: ProviderModelRoute, protocol: Protocol) {
  return model.endpoints.find(endpoint => endpoint.protocol === protocol)
}

/**
 * 查找可接�?clientProtocol 请求（经协议转换）的端点�?
 * 仅返回显式开�?protocolConversionEnabled 的端点�?
 */
export function findConvertibleEndpoint(model: ProviderModelRoute, clientProtocol: Protocol) {
  return model.endpoints.find(
    endpoint => endpoint.protocolConversionEnabled === true && isConvertible(endpoint.protocol, clientProtocol),
  )
}

/**
 * 从请求路径中检测协议类�?
 */
export function detectProtocolFromPath(pathname: string): Protocol | null {
  return protocolRouter.match('POST', pathname)?.handler ?? null
}

const protocolRouter = new HttpRouter<Protocol>()
registerOpenAiCompletionsRoutes(protocolRouter)
registerOpenAiResponsesRoutes(protocolRouter)
registerAnthropicMessagesRoutes(protocolRouter)
