import { calculateProviderModelMetrics, providerModelMetricKey } from '@common/provider-model-metrics'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import type { ProviderHealth, ProviderModelHealth, RequestAttempt } from '@common/schemas'
import type { TrayLogicalModelSummary, TrayProviderModelSummary } from '@common/tray-panel'
import { listProviderHealth, listProviderModelHealth } from '../database/health-store'
import { listLogicalModels } from '../database/logical-model-store'
import { listProviderModelsForLogicalModels } from '../database/model-store'
import { listProviders } from '../database/provider-store'
import { listAttemptsByRequests, listRequestLogs } from '../database/request-log-store'

/**
 * 把逻辑模型与调度绑定压成托盘能直接消费的展示摘要。
 *
 * 托盘窗口的主进程侧不读数据库，这条查询留在核心服务进程里；服务只回面板需要的
 * 模型展示摘要，不把完整调度配置和端点 URL 穿过进程边界。
 */
export async function listTrayLogicalModels(): Promise<TrayLogicalModelSummary[]> {
  const logicalModels = await listLogicalModels()
  const logicalModelIds = logicalModels.map(model => model.id)
  const [modelsByLogicalModel, providers, providerHealth, providerModelHealth] = await Promise.all([
    listProviderModelsForLogicalModels(logicalModelIds, false, true),
    listProviders(),
    listProviderHealth(),
    listProviderModelHealth(),
  ])
  const providerNames = new Map(providers.map(provider => [provider.id, provider.name]))
  const providerHealthById = new Map(providerHealth.map(health => [health.providerId, health]))
  const providerModelHealthById = new Map(providerModelHealth.map(health => [health.providerModelId, health]))
  const metricsByLogicalModel = new Map(await Promise.all(logicalModelIds.map(async id => [id, await listMetrics(id)] as const)))

  return logicalModels.map(model => {
    const models = modelsByLogicalModel.get(model.id) ?? []
    const metrics = metricsByLogicalModel.get(model.id) ?? {}
    return {
      id: model.id,
      name: model.name,
      models: models.map(item => {
        const metric = metrics[providerModelMetricKey(item.providerId, item.id)]
        const nativeProtocols = new Set(item.endpoints.map(endpoint => endpoint.protocol))
        const conversionProtocols = Array.from(new Set(item.endpoints
          .filter(endpoint => endpoint.protocolConversionEnabled)
          .flatMap(endpoint => CONVERTIBLE_PROTOCOLS[endpoint.protocol])
          .filter(protocol => !nativeProtocols.has(protocol))))
        return {
          id: item.id,
          providerId: item.providerId,
          providerName: providerNames.get(item.providerId) ?? '',
          modelName: item.modelName,
          protocols: Array.from(nativeProtocols),
          conversionProtocols,
          enabled: item.enabled,
          modelEnabled: item.modelEnabled,
          cooling: isCooling({ model: item, providerHealthById, providerModelHealthById }),
          avgTps: metric?.avgTps ?? null,
          avgTtftMilliseconds: metric?.avgTtftMilliseconds ?? null,
        } satisfies TrayProviderModelSummary
      }),
    }
  })
}

async function listMetrics(logicalModelId: string) {
  const logs = await listRequestLogs(100, 0, { logicalModelId })
  const attempts = await listAttemptsByRequests(logs.map(log => log.id))
  const attemptsByRequest = new Map<string, RequestAttempt[]>()
  for (const attempt of attempts) {
    const requestAttempts = attemptsByRequest.get(attempt.requestId) ?? []
    requestAttempts.push(attempt)
    attemptsByRequest.set(attempt.requestId, requestAttempts)
  }
  return calculateProviderModelMetrics(logs.map(log => ({
    id: log.id,
    status: log.status,
    outputTokens: log.outputTokens,
    attempts: attemptsByRequest.get(log.id) ?? [],
  })))
}

interface HealthLookupModel {
  id: string
  providerId: string
}

interface ResolveCoolingInput {
  model: HealthLookupModel
  providerHealthById: ReadonlyMap<string, ProviderHealth>
  providerModelHealthById: ReadonlyMap<string, ProviderModelHealth>
}

function isCooling(input: ResolveCoolingInput): boolean {
  const time = Date.now()
  const modelCooldown = input.providerModelHealthById.get(input.model.id)?.cooldownUntilTime
  const providerCooldown = input.providerHealthById.get(input.model.providerId)?.cooldownUntilTime
  return Boolean((modelCooldown && modelCooldown > time) || (providerCooldown && providerCooldown > time))
}
