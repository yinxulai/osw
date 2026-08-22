import type { Provider, LogicalModel } from '@common/schemas'
import { listProviderEndpoints, listProviders } from '../../database/provider-store'
import { listLogicalModels, listSchedulingPolicies } from '../../database/logical-model-store'
import { listProviderModels } from '../../database/model-store'
import { getSettings } from '../../database/settings-store'
import type { ConfigDocument, ConfigProvider, ConfigLogicalModel } from '@common/config-schemas'

export async function exportConfig(): Promise<{ config: ConfigDocument; content: string }> {
  const [providers, logicalModels, providerModels, schedulingPolicies, settings] = await Promise.all([
    listProviders(false), listLogicalModels(false), listProviderModels(false), listSchedulingPolicies(), getSettings(),
  ])
  const config: ConfigDocument = {
    schemaVersion: 3,
    exportedAt: Date.now(),
    settings: {
      listenHost: settings.listenHost, listenPort: settings.listenPort, logRetentionDays: settings.logRetentionDays,
      cooldownBaseSeconds: settings.cooldownBaseSeconds, cooldownMaxSeconds: settings.cooldownMaxSeconds,
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold, idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
      autoLaunch: settings.autoLaunch,
    },
    providers: await Promise.all(providers.map(async (p: Provider): Promise<ConfigProvider> => ({
      id: p.id, name: p.name, timeoutMilliseconds: p.timeoutMilliseconds, enabled: p.enabled,
      apiKeyPlaceholder: '***',
      endpoints: Object.fromEntries((await listProviderEndpoints(p.id)).filter(endpoint => endpoint.enabled).map(endpoint => [endpoint.protocol, endpoint.url])),
    }))),
    logicalModels: logicalModels.map((m: LogicalModel): ConfigLogicalModel => ({ id: m.id, name: m.name, description: m.description, enabled: m.enabled })),
    providerModels: providerModels.map(model => ({
      id: model.id, providerId: model.providerId, modelName: model.modelName, enabled: model.enabled,
      endpoints: model.endpoints.map(endpoint => ({
        protocol: endpoint.protocol, url: endpoint.url, enabled: endpoint.enabled,
        conversions: endpoint.conversions.map(converter => ({ clientProtocol: converter.clientProtocol, enabled: converter.enabled })),
      })),
    })),
    schedulingPolicies: schedulingPolicies.map(policy => ({
      logicalModelId: policy.logicalModelId, providerModelId: policy.providerModelId, strategy: policy.strategy,
      priority: policy.priority, weight: policy.weight, enabled: policy.enabled,
    })),
  }
  return { config, content: JSON.stringify(config, null, 2) }
}
