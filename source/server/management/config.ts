import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { generateKeyReference } from '@common/keychain'
import { ProtocolSchema, UpstreamUrlsSchema, type Provider, type LogicalModel, type Settings } from '@common/schemas'
import type { ManagementHandler } from './response'
import { sendSuccess, sendError } from './response'
import {
  listProviders,
  listLogicalModels,
  listProviderModels,
  listSchedulingPolicies,
  listProviderModelRoutes,
  getSettings,
  updateSettings,
  createProvider,
  updateProvider,
  createLogicalModel,
  updateLogicalModel,
  createProviderModelRoute,
  updateProviderModelRoute,
  upsertSchedulingPolicy,
  deleteProvider,
  deleteLogicalModel,
  deleteProviderModelRoute,
} from '../database/store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { seedDevelopmentData } from '../database/development-seed'

export const configRoutes: Record<string, ManagementHandler> = {
  '/api/config/export': handleExportConfig,
  '/api/config/import': handleImportConfig,
  '/api/config/seed-development': handleSeedDevelopment,
}

async function handleSeedDevelopment(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const inserted = await seedDevelopmentData(getSecretStore(), { allowExisting: true })
  sendSuccess(res, { inserted })
}

// ========== 导出配置 ==========

interface ExportedProvider {
  id: string
  name: string
  timeoutMilliseconds: number
  enabled: boolean
  apiKeyPlaceholder: string
  endpoints: Record<string, string>
}

interface ExportedLogicalModel {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface ExportedProviderModel {
  id: string
  providerId: string
  modelName: string
  enabled: boolean
  endpoints: Array<{
    protocol: string
    url: string | null
    enabled: boolean
    conversions: Array<{ clientProtocol: string; enabled: boolean }>
  }>
}

interface ExportedSchedulingPolicy {
  logicalModelId: string
  providerModelId: string
  strategy: string
  priority: number
  weight: number
  enabled: boolean
  failoverEnabled: boolean
}

interface ExportedConfig {
  version: 3
  exportedAt: number
  settings: Partial<Settings>
  providers: ExportedProvider[]
  logicalModels: ExportedLogicalModel[]
  providerModels: ExportedProviderModel[]
  schedulingPolicies: ExportedSchedulingPolicy[]
}

async function handleExportConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [providers, logicalModels, providerModels, schedulingPolicies, settings] = await Promise.all([
    listProviders(false),
    listLogicalModels(false),
    listProviderModels(false),
    listSchedulingPolicies(),
    getSettings(),
  ])

  const config: ExportedConfig = {
    version: 3,
    exportedAt: Date.now(),
    settings: {
      listenHost: settings.listenHost,
      listenPort: settings.listenPort,
      logRetentionCount: settings.logRetentionCount,
      cooldownBaseSeconds: settings.cooldownBaseSeconds,
      cooldownMaxSeconds: settings.cooldownMaxSeconds,
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold,
      idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
      autoLaunch: settings.autoLaunch,
    },
    providers: providers.map((p: Provider): ExportedProvider => ({
      id: p.id,
      name: p.name,
      timeoutMilliseconds: p.timeoutMilliseconds,
      enabled: p.enabled,
      apiKeyPlaceholder: '***',
      endpoints: parseEndpoints(p.upstreamUrls),
    })),
    logicalModels: logicalModels.map((m: LogicalModel): ExportedLogicalModel => ({
      id: m.id,
      name: m.name,
      description: m.description,
      enabled: m.enabled,
    })),
    providerModels: providerModels.map(model => ({
      id: model.id,
      providerId: model.providerId,
      modelName: model.modelName,
      enabled: model.enabled,
      endpoints: model.endpoints.map(endpoint => ({
        protocol: endpoint.protocol,
        url: endpoint.url,
        enabled: endpoint.enabled,
        conversions: endpoint.conversions.map(converter => ({ clientProtocol: converter.clientProtocol, enabled: converter.enabled })),
      })),
    })),
    schedulingPolicies: schedulingPolicies.map(policy => ({
      logicalModelId: policy.logicalModelId,
      providerModelId: policy.providerModelId,
      strategy: policy.strategy,
      priority: policy.priority,
      weight: policy.weight,
      enabled: policy.enabled,
      failoverEnabled: policy.failoverEnabled,
    })),
  }

  sendSuccess(res, { config, content: JSON.stringify(config, null, 2) })
}

function parseEndpoints(upstreamUrls: string): Record<string, string> {
  try {
    return JSON.parse(upstreamUrls) as Record<string, string>
  } catch {
    return {}
  }
}

// ========== 导入配置 ==========

const ImportConfigSchema = z.object({
  config: z.object({
    version: z.literal(3),
    settings: z.object({
      listenHost: z.string().optional(),
      listenPort: z.number().int().min(1).max(65535).optional(),
      logRetentionCount: z.number().int().positive().optional(),
      logRetentionDays: z.number().int().positive().nullable().optional(),
      captureRequestContent: z.boolean().optional(),
      cooldownBaseSeconds: z.number().int().positive().optional(),
      cooldownMaxSeconds: z.number().int().positive().optional(),
      consecutiveFailureThreshold: z.number().int().positive().optional(),
      idleTimeoutMilliseconds: z.number().int().positive().optional(),
      autoLaunch: z.boolean().optional(),
    }).default({}),
    providers: z.array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        timeoutMilliseconds: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
        apiKey: z.string().optional(),
        endpoints: UpstreamUrlsSchema.optional(),
      }),
    ).default([]),
    logicalModels: z.array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    ).default([]),
    providerModels: z.array(
      z.object({
        id: z.string().optional(),
        providerId: z.string(),
        modelName: z.string(),
        enabled: z.boolean().optional(),
        endpoints: z.array(z.object({
          protocol: ProtocolSchema,
          url: z.string().nullable().optional(),
          enabled: z.boolean().optional(),
          conversions: z.array(z.object({ clientProtocol: ProtocolSchema, enabled: z.boolean().optional() })).optional(),
        })).optional(),
      }),
    ).default([]),
    schedulingPolicies: z.array(z.object({
      logicalModelId: z.string(),
      providerModelId: z.string(),
      strategy: z.string().optional(),
      priority: z.number().int(),
      weight: z.number().int().optional(),
      enabled: z.boolean().optional(),
      failoverEnabled: z.boolean().optional(),
    })).default([]),
  }),
  mode: z.enum(['merge', 'replace']).default('merge'),
})

async function handleImportConfig(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  try {
    const { config, mode } = ImportConfigSchema.parse(body)
    const secretStore = getSecretStore()

    const existingProviders = await listProviders(false)
    const existingModels = await listLogicalModels(false)
    const existingProviderModelRoutes = await listProviderModelRoutes(false)
    const importedPolicies = config.schedulingPolicies
    const existingProviderIds = new Set(existingProviders.map(provider => provider.id))
    const providerIdMap = new Map<string, string>()
    const importedProviderNames = new Set<string>()
    const importedModelNames = new Set<string>()
    const importedProviderModelKeys = new Set<string>()

    for (const provider of config.providers) {
      if (importedProviderNames.has(provider.name)) {
        throw new Error(`导入文件中存在重复供应商: ${provider.name}`)
      }
      importedProviderNames.add(provider.name)
    }

    for (const model of config.logicalModels) {
      if (importedModelNames.has(model.name)) {
        throw new Error(`导入文件中存在重复逻辑模型: ${model.name}`)
      }
      importedModelNames.add(model.name)
    }

    // 1. 更新设置
    if (Object.keys(config.settings).length > 0) {
      await updateSettings(config.settings)
    }

    // 2. 处理供应商
    const importedProviderIds = new Set<string>()
    let importedProviders = 0

    for (const p of config.providers) {
      const existing = existingProviders.find(ep => ep.name === p.name)
      if (existing) {
        if (p.id) providerIdMap.set(p.id, existing.id)
        const updates: Partial<Pick<Provider, 'name' | 'timeoutMilliseconds' | 'enabled' | 'upstreamUrls'>> = {
          name: p.name,
        }
        if (p.timeoutMilliseconds !== undefined) updates.timeoutMilliseconds = p.timeoutMilliseconds
        if (p.enabled !== undefined) updates.enabled = p.enabled
        if (p.endpoints !== undefined) updates.upstreamUrls = JSON.stringify(p.endpoints)
        if (p.apiKey) await secretStore.set(existing.apiKeyReference, p.apiKey)
        const updated = await updateProvider(existing.id, updates)
        if (p.id) providerIdMap.set(p.id, updated.id)
        importedProviderIds.add(updated.id)
      } else {
        const apiKeyReference = generateKeyReference()
        if (p.apiKey) await secretStore.set(apiKeyReference, p.apiKey)
        const created = await createProvider({
          name: p.name,
          apiKeyReference,
          timeoutMilliseconds: p.timeoutMilliseconds ?? 30000,
          enabled: p.enabled ?? true,
          upstreamUrls: p.endpoints ? JSON.stringify(p.endpoints) : '{}',
        })
        if (p.id) providerIdMap.set(p.id, created.id)
        importedProviderIds.add(created.id)
      }
      importedProviders++
    }

    // 3. 处理逻辑模型
    const importedModelIds = new Set<string>()
    const logicalModelIdMap = new Map<string, string>()
    let importedLogicalModels = 0

    for (const m of config.logicalModels) {
      const existing = existingModels.find(em => em.name === m.name)
      if (existing) {
        const updated = await updateLogicalModel(existing.id, {
          name: m.name,
          description: m.description ?? '',
          enabled: m.enabled ?? true,
        })
        importedModelIds.add(updated.id)
        if (m.id) logicalModelIdMap.set(m.id, updated.id)
      } else {
        const created = await createLogicalModel({
          name: m.name,
          description: m.description ?? '',
          enabled: m.enabled ?? true,
        })
        importedModelIds.add(created.id)
        if (m.id) logicalModelIdMap.set(m.id, created.id)
      }
      importedLogicalModels++
    }

    // 4. 处理 ProviderModel
    let importedProviderModels = 0
    const importedProviderModelIds = new Map<string, string>()
    for (const model of config.providerModels) {
      const resolvedProviderId = providerIdMap.get(model.providerId) ?? model.providerId
      if (!existingProviderIds.has(resolvedProviderId) && !importedProviderIds.has(resolvedProviderId)) {
        sendError(res, 'VALIDATION_ERROR', `ProviderModel "${model.modelName}" 引用了不存在的供应商`, 400)
        return
      }
      const key = `${resolvedProviderId}\0${model.modelName}`
      if (importedProviderModelKeys.has(key)) throw new Error(`导入文件中存在重复 ProviderModel: ${model.modelName}`)
      importedProviderModelKeys.add(key)
      const existing = existingProviderModelRoutes.find(route => route.providerId === resolvedProviderId && route.modelName === model.modelName)
      const endpoints = (model.endpoints ?? []).map(endpoint => ({
        protocol: endpoint.protocol,
        upstreamUrl: endpoint.url ?? '',
        customAuthHeader: null,
        protocolConversionEnabled: endpoint.conversions?.some(conversion => conversion.enabled) ?? false,
      }))
      const imported = existing
        ? await updateProviderModelRoute(existing.id, { endpoints, enabled: model.enabled ?? true })
        : await createProviderModelRoute({ providerId: resolvedProviderId, modelName: model.modelName, endpoints, priority: importedPolicies.find(policy => policy.providerModelId === model.id)?.priority ?? 0, enabled: model.enabled ?? true })
      if (model.id) importedProviderModelIds.set(model.id, imported.id)
      importedProviderModels++
    }

    for (const policy of importedPolicies) {
      const providerModelId = importedProviderModelIds.get(policy.providerModelId) ?? policy.providerModelId
      const logicalModelId = logicalModelIdMap.get(policy.logicalModelId) ?? policy.logicalModelId
      await upsertSchedulingPolicy({
        logicalModelId,
        providerModelId,
        strategy: policy.strategy,
        priority: policy.priority,
        weight: policy.weight,
        enabled: policy.enabled,
        failoverEnabled: policy.failoverEnabled,
      })
    }

    if (mode === 'replace') {
      for (const providerModel of existingProviderModelRoutes) {
        const key = `${providerModel.providerId}\0${providerModel.modelName}`
        if (!importedProviderModelKeys.has(key)) await deleteProviderModelRoute(providerModel.id)
      }
      for (const model of existingModels) {
        if (!importedModelIds.has(model.id)) await deleteLogicalModel(model.id)
      }
      for (const provider of existingProviders) {
        if (!importedProviderIds.has(provider.id)) {
          await deleteProvider(provider.id)
          await secretStore.delete(provider.apiKeyReference)
        }
      }
    }

    sendSuccess(res, {
      imported: {
        providers: importedProviders,
        logicalModels: importedLogicalModels,
        providerModels: importedProviderModels,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendError(res, 'VALIDATION_ERROR', `导入失败：${message}`, 400)
  }
}
