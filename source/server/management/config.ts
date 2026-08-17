import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { generateKeyReference } from '@common/keychain'
import { UpstreamUrlsSchema, type Provider, type LogicalModel, type UpstreamModel, type Settings } from '@common/schemas'
import type { ManagementHandler } from './response'
import { sendSuccess, sendError } from './response'
import {
  listProviders,
  listLogicalModels,
  listUpstreamModels,
  getSettings,
  updateSettings,
  createProvider,
  updateProvider,
  createLogicalModel,
  updateLogicalModel,
  createUpstreamModel,
  updateUpstreamModel,
} from '../database/store'
import { getSecretStore } from '../infrastructure/secrets/secret-store'

export const configRoutes: Record<string, ManagementHandler> = {
  '/api/config/export': handleExportConfig,
  '/api/config/import': handleImportConfig,
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

interface ExportedUpstreamModel {
  id: string
  logicalModelName: string
  providerName: string
  upstreamModelId: string
  endpoints: UpstreamModel['endpoints']
  priority: number
  enabled: boolean
}

interface ExportedConfig {
  version: 1
  exportedAt: number
  settings: Partial<Settings>
  providers: ExportedProvider[]
  logicalModels: ExportedLogicalModel[]
  upstreamModels: ExportedUpstreamModel[]
}

async function handleExportConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [providers, logicalModels, upstreamModels, settings] = await Promise.all([
    listProviders(false),
    listLogicalModels(false),
    listUpstreamModels(false),
    getSettings(),
  ])

  const providerById = new Map(providers.map(p => [p.id, p]))
  const logicalModelById = new Map(logicalModels.map(m => [m.id, m]))

  const config: ExportedConfig = {
    version: 1,
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
    upstreamModels: upstreamModels.map((m: UpstreamModel): ExportedUpstreamModel => ({
      id: m.id,
      logicalModelName: logicalModelById.get(m.logicalModelId)?.name ?? '',
      providerName: providerById.get(m.providerId)?.name ?? '',
      upstreamModelId: m.upstreamModelId,
      endpoints: m.endpoints,
      priority: m.priority,
      enabled: m.enabled,
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
    version: z.literal(1),
    settings: z.object({
      listenHost: z.string().optional(),
      listenPort: z.number().int().min(1).max(65535).optional(),
      logRetentionCount: z.number().int().positive().optional(),
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
    upstreamModels: z.array(
      z.object({
        id: z.string().optional(),
        logicalModelName: z.string().optional(),
        providerName: z.string().optional(),
        logicalModelId: z.string().optional(),
        providerId: z.string().optional(),
        upstreamModelId: z.string(),
        endpoints: z.array(z.any()).optional(),
        priority: z.number().int(),
        enabled: z.boolean().optional(),
      }),
    ).default([]),
  }),
  mode: z.enum(['merge', 'replace']).default('merge'),
})

async function handleImportConfig(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  try {
    const { config } = ImportConfigSchema.parse(body)
    const secretStore = getSecretStore()

    // 1. 更新设置
    if (Object.keys(config.settings).length > 0) {
      await updateSettings(config.settings)
    }

    // 2. 处理供应商
    const existingProviders = await listProviders(false)
    const providerNameToId = new Map<string, string>()
    let importedProviders = 0

    for (const p of config.providers) {
      const existing = existingProviders.find(ep => ep.name === p.name)
      if (existing) {
        const updates: Partial<Pick<Provider, 'name' | 'timeoutMilliseconds' | 'enabled' | 'upstreamUrls'>> = {
          name: p.name,
        }
        if (p.timeoutMilliseconds !== undefined) updates.timeoutMilliseconds = p.timeoutMilliseconds
        if (p.enabled !== undefined) updates.enabled = p.enabled
        if (p.endpoints !== undefined) updates.upstreamUrls = JSON.stringify(p.endpoints)
        if (p.apiKey) await secretStore.set(existing.apiKeyReference, p.apiKey)
        const updated = await updateProvider(existing.id, updates)
        providerNameToId.set(p.name, updated.id)
      } else {
        if (!p.apiKey) {
          sendError(res, 'VALIDATION_ERROR', `供应商 "${p.name}" 缺少 API Key，请在导入文件中添加 apiKey 字段`, 400)
          return
        }
        const apiKeyReference = generateKeyReference()
        await secretStore.set(apiKeyReference, p.apiKey)
        const created = await createProvider({
          name: p.name,
          apiKeyReference,
          timeoutMilliseconds: p.timeoutMilliseconds ?? 30000,
          enabled: p.enabled ?? true,
          upstreamUrls: p.endpoints ? JSON.stringify(p.endpoints) : '{}',
        })
        providerNameToId.set(p.name, created.id)
      }
      importedProviders++
    }

    // 3. 处理逻辑模型
    const existingModels = await listLogicalModels(false)
    const modelNameToId = new Map<string, string>()
    let importedLogicalModels = 0

    for (const m of config.logicalModels) {
      const existing = existingModels.find(em => em.name === m.name)
      if (existing) {
        const updated = await updateLogicalModel(existing.id, {
          name: m.name,
          description: m.description ?? '',
          enabled: m.enabled ?? true,
        })
        modelNameToId.set(m.name, updated.id)
      } else {
        const created = await createLogicalModel({
          name: m.name,
          description: m.description ?? '',
          enabled: m.enabled ?? true,
        })
        modelNameToId.set(m.name, created.id)
      }
      importedLogicalModels++
    }

    // 4. 处理上游模型
    const existingUpstreamModels = await listUpstreamModels(false)
    let importedUpstreamModels = 0

    for (const um of config.upstreamModels) {
      let logicalModelId = um.logicalModelId
      if (!logicalModelId && um.logicalModelName) {
        logicalModelId = modelNameToId.get(um.logicalModelName)
      }
      if (!logicalModelId) {
        sendError(res, 'VALIDATION_ERROR', `上游模型 "${um.upstreamModelId}" 无法找到对应的逻辑模型`, 400)
        return
      }

      let providerId = um.providerId
      if (!providerId && um.providerName) {
        providerId = providerNameToId.get(um.providerName)
      }
      if (!providerId) {
        sendError(res, 'VALIDATION_ERROR', `上游模型 "${um.upstreamModelId}" 无法找到对应的供应商`, 400)
        return
      }

      const existing = existingUpstreamModels.find(
        (eum: UpstreamModel) =>
          eum.logicalModelId === logicalModelId &&
          eum.providerId === providerId &&
          eum.upstreamModelId === um.upstreamModelId,
      )

      if (existing) {
        await updateUpstreamModel(existing.id, {
          endpoints: um.endpoints ?? [],
          priority: um.priority,
          enabled: um.enabled ?? true,
        })
      } else {
        await createUpstreamModel({
          logicalModelId,
          providerId,
          upstreamModelId: um.upstreamModelId,
          endpoints: um.endpoints ?? [],
          priority: um.priority,
          enabled: um.enabled ?? true,
        })
      }
      importedUpstreamModels++
    }

    sendSuccess(res, {
      imported: {
        providers: importedProviders,
        logicalModels: importedLogicalModels,
        upstreamModels: importedUpstreamModels,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendError(res, 'VALIDATION_ERROR', `导入失败：${message}`, 400)
  }
}
