import { generateKeyReference } from '@common/keychain'
import type { Provider } from '@common/schemas'
import { ImportConfigSchema } from './schemas'
import { createProvider, deleteProvider, listProviders, replaceProviderEndpoints, updateProvider } from '../../database/provider-store'
import { createLogicalModel, deleteLogicalModel, listLogicalModels, updateLogicalModel, upsertSchedulingPolicy } from '../../database/logical-model-store'
import { createProviderModelRoute, deleteProviderModelRoute, listProviderModelRoutes as listRoutes, updateProviderModelRoute } from '../../database/model-store'
import { updateSettings } from '../../database/settings-store'
import { getSecretStore } from '../../infrastructure/secrets/secret-store'

export async function importConfig(body: unknown): Promise<{ imported: { providers: number; logicalModels: number; providerModels: number } }> {
  const { config, mode } = ImportConfigSchema.parse(body)
  const secretStore = getSecretStore()
  const existingProviders = await listProviders(false)
  const existingModels = await listLogicalModels(false)
  const existingProviderModelRoutes = await listRoutes(false)
  const existingProviderIds = new Set(existingProviders.map(provider => provider.id))
  const providerIdMap = new Map<string, string>()
  const importedProviderNames = new Set<string>()
  const importedModelNames = new Set<string>()
  const importedProviderModelKeys = new Set<string>()

  for (const provider of config.providers) {
    if (importedProviderNames.has(provider.name)) throw new Error(`导入文件中存在重复供应商: ${provider.name}`)
    importedProviderNames.add(provider.name)
  }
  for (const model of config.logicalModels) {
    if (importedModelNames.has(model.name)) throw new Error(`导入文件中存在重复逻辑模型: ${model.name}`)
    importedModelNames.add(model.name)
  }
  if (Object.keys(config.settings).length > 0) await updateSettings({ ...config.settings, logRetentionDays: config.settings.logRetentionDays ?? undefined })

  const importedProviderIds = new Set<string>()
  let importedProviders = 0
  for (const p of config.providers) {
    const existing = existingProviders.find(ep => ep.name === p.name)
    if (existing) {
      if (p.id) providerIdMap.set(p.id, existing.id)
      const updates: Partial<Pick<Provider, 'name' | 'timeoutMilliseconds' | 'enabled'>> = { name: p.name }
      if (p.timeoutMilliseconds !== undefined) updates.timeoutMilliseconds = p.timeoutMilliseconds
      if (p.enabled !== undefined) updates.enabled = p.enabled
      if (p.apiKey) await secretStore.set(existing.apiKeyReference, p.apiKey)
      const updated = await updateProvider(existing.id, updates)
      if (p.endpoints !== undefined) await replaceProviderEndpoints(updated.id, p.endpoints)
      if (p.id) providerIdMap.set(p.id, updated.id)
      importedProviderIds.add(updated.id)
    } else {
      const apiKeyReference = generateKeyReference()
      if (p.apiKey) await secretStore.set(apiKeyReference, p.apiKey)
      const created = await createProvider({ name: p.name, apiKeyReference, timeoutMilliseconds: p.timeoutMilliseconds ?? 30000, enabled: p.enabled ?? true })
      await replaceProviderEndpoints(created.id, p.endpoints ?? {})
      if (p.id) providerIdMap.set(p.id, created.id)
      importedProviderIds.add(created.id)
    }
    importedProviders++
  }

  const importedModelIds = new Set<string>()
  const logicalModelIdMap = new Map<string, string>()
  let importedLogicalModels = 0
  for (const m of config.logicalModels) {
    const existing = existingModels.find(em => em.name === m.name)
    const model = existing
      ? await updateLogicalModel(existing.id, { name: m.name, description: m.description ?? '', enabled: m.enabled ?? true })
      : await createLogicalModel({ name: m.name, description: m.description ?? '', enabled: m.enabled ?? true })
    importedModelIds.add(model.id)
    if (m.id) logicalModelIdMap.set(m.id, model.id)
    importedLogicalModels++
  }

  let importedProviderModels = 0
  const importedProviderModelIds = new Map<string, string>()
  for (const model of config.providerModels) {
    const resolvedProviderId = providerIdMap.get(model.providerId) ?? model.providerId
    if (!existingProviderIds.has(resolvedProviderId) && !importedProviderIds.has(resolvedProviderId)) throw new Error(`ProviderModel "${model.modelName}" 引用了不存在的供应商`)
    const key = `${resolvedProviderId}\0${model.modelName}`
    if (importedProviderModelKeys.has(key)) throw new Error(`导入文件中存在重复 ProviderModel: ${model.modelName}`)
    importedProviderModelKeys.add(key)
    const existing = existingProviderModelRoutes.find(route => route.providerId === resolvedProviderId && route.modelName === model.modelName)
    const endpoints = (model.endpoints ?? []).map(endpoint => ({ protocol: endpoint.protocol, upstreamUrl: endpoint.url ?? '', customAuthHeader: null, protocolConversionEnabled: endpoint.conversions?.some(conversion => conversion.enabled) ?? false }))
    const imported = existing
      ? await updateProviderModelRoute(existing.id, { endpoints, enabled: model.enabled ?? true })
      : await createProviderModelRoute({ providerId: resolvedProviderId, modelName: model.modelName, endpoints, priority: config.schedulingPolicies.find(policy => policy.providerModelId === model.id)?.priority ?? 0, enabled: model.enabled ?? true })
    if (model.id) importedProviderModelIds.set(model.id, imported.id)
    importedProviderModels++
  }
  for (const policy of config.schedulingPolicies) {
    await upsertSchedulingPolicy({
      logicalModelId: logicalModelIdMap.get(policy.logicalModelId) ?? policy.logicalModelId,
      providerModelId: importedProviderModelIds.get(policy.providerModelId) ?? policy.providerModelId,
      strategy: policy.strategy, priority: policy.priority, weight: policy.weight, enabled: policy.enabled,
    })
  }
  if (mode === 'replace') {
    for (const providerModel of existingProviderModelRoutes) if (!importedProviderModelKeys.has(`${providerModel.providerId}\0${providerModel.modelName}`)) await deleteProviderModelRoute(providerModel.id)
    for (const model of existingModels) if (!importedModelIds.has(model.id)) await deleteLogicalModel(model.id)
    for (const provider of existingProviders) if (!importedProviderIds.has(provider.id)) { await deleteProvider(provider.id); await secretStore.delete(provider.apiKeyReference) }
  }
  return { imported: { providers: importedProviders, logicalModels: importedLogicalModels, providerModels: importedProviderModels } }
}
