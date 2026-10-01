import { AppError } from '@server/errors'
import { PROVIDER_BUNDLE_FORMAT, PROVIDER_BUNDLE_VERSION, ProviderBundleExportRequestSchema } from '@common/provider-bundle'
import type { ProviderBundle, ProviderBundleExportRequest, ProviderBundleProvider } from '@common/provider-bundle'
import type { Provider } from '@common/schemas'
import { listProviderModels } from '@server/database/model-store'
import type { ProviderModelView } from '@server/database/model-store'
import { listProviderEndpoints, listProviderSettings, listProviders } from '@server/database/provider-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'

/**
 * 由 store 直接托管、因此不作为「自定义设置」进包的两个 key。
 *
 * `security.secretReference` 是本机密钥库里的引用，换台机器就没有意义；`connection.timeoutMilliseconds`
 * 已经是包里的顶层字段 `timeoutMilliseconds`。把它们排除掉，导入时就不会用源环境的引用覆盖目标环境。
 */
export const MANAGED_PROVIDER_SETTING_KEYS: readonly string[] = ['security.secretReference', 'connection.timeoutMilliseconds']

const managedSettingKeys = new Set(MANAGED_PROVIDER_SETTING_KEYS)

/**
 * 导出供应商包。
 *
 * 包描述的是「一个供应商现在长什么样」，所以是**完整快照**而不是补丁：端点、自定义设置、下属模型
 * 全都带上，包含被停用的端点（那一行还留着用户填过的 URL，是用户可见状态而不是缓存）。
 *
 * 不含请求重写规则的绑定：规则本体是独立于供应商的实体，把绑定导出到另一个环境只会得到悬空引用，
 * FK 也不允许。规则需要单独迁移。
 */
export async function exportProviderBundle(body: unknown): Promise<{ bundle: ProviderBundle; content: string }> {
  const { providerIds, includeApiKeys } = ProviderBundleExportRequestSchema.parse(body)
  const selected = selectProviders(await listProviders(false), providerIds)
  const modelsByProvider = groupModelsByProvider(await listProviderModels(false))
  const providers: ProviderBundleProvider[] = []
  for (const provider of selected) {
    providers.push(await buildProviderEntry(provider, modelsByProvider.get(provider.id) ?? [], includeApiKeys))
  }

  const bundle: ProviderBundle = {
    format: PROVIDER_BUNDLE_FORMAT,
    version: PROVIDER_BUNDLE_VERSION,
    exportedAt: Date.now(),
    providers,
  }
  return { bundle, content: JSON.stringify(bundle, null, 2) }
}

/** 省略 `providerIds` 即导出全部未删除的供应商（含已停用）；显式给出时保持调用方顺序，并让不存在的 ID 明确失败而不是静默少导。 */
function selectProviders(providers: Provider[], providerIds: ProviderBundleExportRequest['providerIds']): Provider[] {
  if (!providerIds) return providers

  const byId = new Map(providers.map(provider => [provider.id, provider]))
  const selected: Provider[] = []
  const missing: string[] = []
  for (const id of new Set(providerIds)) {
    const provider = byId.get(id)
    if (provider) selected.push(provider)
    else missing.push(id)
  }
  if (missing.length > 0) throw new AppError('RESOURCE_NOT_FOUND', 404, `Provider not found: ${missing.join(', ')}`, { details: { providerIds: missing.join(', ') } })
  return selected
}

function groupModelsByProvider(models: ProviderModelView[]): Map<string, ProviderModelView[]> {
  const grouped = new Map<string, ProviderModelView[]>()
  for (const model of models) {
    const bucket = grouped.get(model.providerId)
    if (bucket) bucket.push(model)
    else grouped.set(model.providerId, [model])
  }
  return grouped
}

async function buildProviderEntry(provider: Provider, models: ProviderModelView[], includeApiKeys: boolean): Promise<ProviderBundleProvider> {
  const [endpoints, settings, apiKey] = await Promise.all([
    listProviderEndpoints(provider.id),
    listProviderSettings(provider.id),
    includeApiKeys ? getSecretStore().get(provider.apiKeyReference) : Promise.resolve(null),
  ])

  return {
    name: provider.name,
    description: provider.description ?? '',
    enabled: provider.enabled,
    timeoutMilliseconds: provider.timeoutMilliseconds,
    // 没取到密钥时省掉整个字段：导入语义是「缺省 = 保留目标环境已有密钥」，
    // 写空串会让源机器自己再导入一次都丢掉凭据。
    ...(apiKey ? { apiKey } : {}),
    endpoints: endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      url: endpoint.url,
      enabled: endpoint.enabled,
    })),
    settings: settings
      .filter(setting => !managedSettingKeys.has(setting.key))
      .map(setting => ({ key: setting.key, value: setting.value, valueType: setting.valueType })),
    models: models.map(model => ({
      // 带上记录 id：同一个供应商下可以有多条同名模型，只靠名字无法一一对上。
      key: model.id,
      modelName: model.modelName,
      enabled: model.enabled,
      endpoints: model.endpoints.map(endpoint => ({
        protocol: endpoint.protocol,
        url: endpoint.url,
        enabled: endpoint.enabled,
        // 当前实现里转换器集合完全由 `CONVERTIBLE_PROTOCOLS[protocol]` 决定，
        // 所以「这一条绑定有没有开转换」就是唯一可配置的自由度，聚合成一个布尔值不会丢信息。
        protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
      })),
    })),
  }
}
