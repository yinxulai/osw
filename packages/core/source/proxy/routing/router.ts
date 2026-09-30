import { listProviderModelsForLogicalModel, listProviderModelsForLogicalModels } from '@server/database/model-store'
import { mapLogicalModelIdsToRecordIds } from '@server/database/logical-model-store'
import { getProvider, listProviders } from '@server/database/provider-store'
import { listProviderHealth, listProviderModelHealth } from '@server/database/health-store'
import { isConvertible } from '@common/protocols'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_ID } from '@common/schemas'
import type { ProviderModelRoute, Provider, Protocol } from '@common/schemas'
import { isProviderAvailable, isProviderModelAvailable } from '@server/proxy/upstream/health'

export interface ModelWithProvider {
  model: ProviderModelRoute
  provider: Provider
}

export interface AvailableModelsOptions {
  /** 手动模式精确指定的模型；忽略模型、供应商及健康状态。 */
  manualModelId?: string | null
}

/**
 * 获取逻辑模型绑定的 ProviderModel 列表，按数据库返回的调度顺序排列。
 * 自动模式保持用户指定的原始顺序：可用模型排在前面，不可用模型整体后移；
 * 两个分组内部都保持用户设置的先后级别。
 * 手动模式只返回指定模型，不受启用状态或健康冷却影响。
 *
 * 入参是**模型 id**（请求里的模型名，也是路由定义里写的落点），不是数据记录 id：
 * 把「请求里的名字」翻译成「绑定表里的外键」是这一层的事，调用方不需要知道有两把钥匙。
 * 查不到这个模型 id（写错名、已被软删除）时返回空列表 —— 它就是一个没有候选的落点。
 */
export async function getAvailableModels(modelId = BUILT_IN_DEFAULT_LOGICAL_MODEL_ID, options: AvailableModelsOptions = {}): Promise<ModelWithProvider[]> {
  const manualModelId = options.manualModelId ?? null
  const recordId = (await mapLogicalModelIdsToRecordIds([modelId])).get(modelId)
  if (recordId === undefined) return []
  const models = await listProviderModelsForLogicalModel(recordId, false, manualModelId !== null)

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

export interface BatchAvailableModelsInput {
  /** 落点的**模型 id**（路由定义里写的那个名字）。 */
  readonly logicalModelId: string
  readonly manualModelId: string | null
}

/**
 * 批量规划多个落点的可用模型。
 *
 * 一次读取全部绑定、供应商与健康状态，把「每个落点各查一次」压缩为固定次数的查询。
 * 名字 → 记录 id 的翻译同样是一次查完的（`mapLogicalModelIdsToRecordIds`）。
 * 每个落点仍遵守与单点版本完全相同的过滤与稳定排序规则；查不到的模型 id 得到空候选。
 */
export async function getAvailableModelsBatch(inputs: readonly BatchAvailableModelsInput[]): Promise<Map<string, ModelWithProvider[]>> {
  const result = new Map<string, ModelWithProvider[]>()
  if (inputs.length === 0) return result

  const recordIds = await mapLogicalModelIdsToRecordIds(inputs.map(input => input.logicalModelId))
  const [modelsByRecordId, providers, providerHealth, providerModelHealth] = await Promise.all([
    listProviderModelsForLogicalModels([...recordIds.values()], false, true),
    listProviders(),
    listProviderHealth(),
    listProviderModelHealth(),
  ])
  const providersById = new Map(providers.map(provider => [provider.id, provider]))
  const providerCooldowns = new Map(providerHealth.map(health => [health.providerId, health.cooldownUntilTime]))
  const modelCooldowns = new Map(providerModelHealth.map(health => [health.providerModelId, health.cooldownUntilTime]))
  const now = Date.now()

  for (const input of inputs) {
    const availableModels: ModelWithProvider[] = []
    const unavailableModels: ModelWithProvider[] = []
    // 结果按**模型 id** 归位：那是调用方给出的键，翻译成记录 id 只是中途的事，
    // 漏回给调用方等于把内部主键漏出这层。
    const recordId = recordIds.get(input.logicalModelId)
    for (const model of recordId === undefined ? [] : modelsByRecordId.get(recordId) ?? []) {
      if (input.manualModelId !== null && model.id !== input.manualModelId) continue
      if (input.manualModelId === null && !model.enabled) continue

      const provider = providersById.get(model.providerId)
      if (!provider || provider.deletedTime !== null) continue

      const candidate = { model, provider }
      if (input.manualModelId !== null) {
        availableModels.push(candidate)
        break
      }
      if (!provider.enabled) continue

      const providerCoolingDown = isCoolingDown(providerCooldowns.get(provider.id), now)
      const modelCoolingDown = isCoolingDown(modelCooldowns.get(model.id), now)
      if (!providerCoolingDown && !modelCoolingDown) availableModels.push(candidate)
      else unavailableModels.push(candidate)
    }
    result.set(input.logicalModelId, [...availableModels, ...unavailableModels])
  }
  return result
}

function isCoolingDown(cooldownUntilTime: number | null | undefined, now: number): boolean {
  return cooldownUntilTime !== null && cooldownUntilTime !== undefined && now < cooldownUntilTime
}

/**
 * 从模型端点列表中查找指定协议的端点。
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
