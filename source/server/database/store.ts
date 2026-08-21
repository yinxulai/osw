import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { SettingsSchema, ProviderSchema } from '@common/schemas'
import type {
  Provider,
  LogicalModel,
  ProviderModel,
  ProviderEndpoint,
  ProviderModelEndpoint,
  ProtocolConverter,
  ProviderModelRoute,
  ProviderModelRouteEndpoint,
  ProviderHealth,
  Settings,
  RequestLog,
  RequestAttempt,
  RequestContent,
  RequestContentCaptureStatus,
  RequestStatus,
  SchedulingPolicy,
} from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import {
  logicalModels,
  providerHealth,
  providerModels,
  providerModelHealth,
  providerEndpoints,
  providerModelEndpoints,
  protocolConverters,
  providerSettings,
  providers,
  requestAttempts,
  requestLogs,
  requestContents,
  requestMetrics,
  requestUsages,
  schedulingPolicies,
  settings,
} from './schema'
import type { ProviderModelHealthRow } from './schema'

// ========== Settings Change Listeners ==========

type SettingsChangeListener = (settings: Settings) => void
const settingsChangeListeners: SettingsChangeListener[] = []

export function onSettingsChanged(listener: SettingsChangeListener): () => void {
  settingsChangeListeners.push(listener)
  return () => {
    const idx = settingsChangeListeners.indexOf(listener)
    if (idx >= 0) settingsChangeListeners.splice(idx, 1)
  }
}

function notifySettingsChanged(newSettings: Settings): void {
  for (const listener of settingsChangeListeners) {
    try {
      listener(newSettings)
    } catch (err) {
      console.error('[store] settings change listener error', err)
    }
  }
}

// ========== Provider ==========

export async function listProviders(includeDeleted = false): Promise<Provider[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db.select().from(providers).orderBy(desc(providers.createdTime)).all()
    : db
        .select()
        .from(providers)
        .where(isNull(providers.deletedTime))
        .orderBy(desc(providers.createdTime))
        .all()
  return rows.map(mapProvider)
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const row = getDb().select().from(providers).where(eq(providers.id, id)).get()
  return row ? mapProvider(row) : undefined
}

type CreateProviderInput = { name: string; description?: string; apiKeyReference: string; timeoutMilliseconds?: number; enabled?: boolean }

export async function createProvider(input: CreateProviderInput): Promise<Provider> {
  const id = generateId('prov_')
  const time = now()
  const db = getDb()
  const provider = ProviderSchema.parse({
    ...input,
    description: input.description ?? '',
    id,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  })
  db.insert(providers)
    .values({
      id,
      name: provider.name,
      description: provider.description ?? '',
      enabled: provider.enabled,
      createdTime: time,
      updatedTime: time,
    })
    .run()
  db.insert(providerSettings).values([
    { providerId: id, key: 'security.secretReference', value: provider.apiKeyReference, valueType: 'string', updatedTime: time },
    { providerId: id, key: 'connection.timeoutMilliseconds', value: String(provider.timeoutMilliseconds), valueType: 'number', updatedTime: time },
  ]).run()
  db.insert(providerHealth)
    .values({
      providerId: id,
      consecutiveFailures: 0,
      updatedTime: time,
    })
    .run()
  return provider
}

export async function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdTime'>>): Promise<Provider> {
  const db = getDb()
  const time = now()
  const existing = db.select().from(providers).where(eq(providers.id, id)).get()
  if (!existing) throw new Error(`provider not found: ${id}`)
  const next = ProviderSchema.parse({
    ...mapProvider(existing),
    ...updates,
    id,
    createdTime: Number(existing.createdTime),
    updatedTime: time,
  })
  db.update(providers)
    .set({
      name: next.name,
      description: next.description ?? '',
      enabled: next.enabled,
      updatedTime: time,
      deletedTime: next.deletedTime,
    })
    .where(and(eq(providers.id, id), isNull(providers.deletedTime)))
    .run()
  const providerSettingUpdates = [
    ['security.secretReference', next.apiKeyReference, 'string'],
    ['connection.timeoutMilliseconds', String(next.timeoutMilliseconds), 'number'],
  ] as const
  for (const [key, value, valueType] of providerSettingUpdates) {
    db.insert(providerSettings).values({ providerId: id, key, value, valueType, updatedTime: time }).onConflictDoUpdate({
      target: [providerSettings.providerId, providerSettings.key],
      set: { value, valueType, updatedTime: time },
    }).run()
  }
  return next
}

export async function listProviderEndpoints(providerId: string): Promise<ProviderEndpoint[]> {
  return getDb()
    .select()
    .from(providerEndpoints)
    .where(eq(providerEndpoints.providerId, providerId))
    .orderBy(providerEndpoints.protocol)
    .all()
    .map(row => ({
      ...row,
      protocol: row.protocol as ProviderEndpoint['protocol'],
      createdTime: Number(row.createdTime),
      updatedTime: Number(row.updatedTime),
    }))
}

export async function replaceProviderEndpoints(providerId: string, endpoints: Partial<Record<ProviderEndpoint['protocol'], string>>): Promise<ProviderEndpoint[]> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    transaction.update(providerEndpoints)
      .set({ enabled: false, updatedTime: time })
      .where(eq(providerEndpoints.providerId, providerId))
      .run()

    for (const [protocol, url] of Object.entries(endpoints)) {
      if (!url?.trim()) continue
      transaction.insert(providerEndpoints).values({
        id: generateId('end_'),
        providerId,
        protocol,
        url: url.trim(),
        enabled: true,
        createdTime: time,
        updatedTime: time,
      }).onConflictDoUpdate({
        target: [providerEndpoints.providerId, providerEndpoints.protocol],
        set: { url: url.trim(), enabled: true, updatedTime: time },
      }).run()
    }
  })
  return listProviderEndpoints(providerId)
}

export async function deleteProvider(id: string): Promise<void> {
  const time = now()
  const db = getDb()
  db.transaction(transaction => {
    transaction
      .update(providers)
      .set({ deletedTime: time, updatedTime: time })
      .where(and(eq(providers.id, id), isNull(providers.deletedTime)))
      .run()
    transaction
      .update(providerModels)
      .set({ enabled: false, updatedTime: time, deletedTime: time })
      .where(and(eq(providerModels.providerId, id), isNull(providerModels.deletedTime)))
      .run()
  })
}

// ========== Logical Model ==========

export async function listLogicalModels(includeDeleted = false): Promise<LogicalModel[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db.select().from(logicalModels).orderBy(desc(logicalModels.createdTime)).all()
    : db
        .select()
        .from(logicalModels)
        .where(isNull(logicalModels.deletedTime))
        .orderBy(desc(logicalModels.createdTime))
        .all()
  return rows.map(mapLogicalModel)
}

export async function getLogicalModel(id: string): Promise<LogicalModel | undefined> {
  const row = getDb().select().from(logicalModels).where(eq(logicalModels.id, id)).get()
  return row ? mapLogicalModel(row) : undefined
}

type CreateLogicalModelInput = Pick<LogicalModel, 'name'> & Partial<Pick<LogicalModel, 'description' | 'enabled'>>

export async function createLogicalModel(input: CreateLogicalModelInput): Promise<LogicalModel> {
  const id = generateId('model_')
  const time = now()
  getDb()
    .insert(logicalModels)
    .values({
      id,
      name: input.name,
      description: input.description ?? '',
      enabled: input.enabled ?? true,
      createdTime: time,
      updatedTime: time,
    })
    .run()
  return {
    id,
    name: input.name,
    description: input.description ?? '',
    enabled: input.enabled ?? true,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
}

export async function updateLogicalModel(id: string, updates: Partial<Omit<LogicalModel, 'id' | 'createdTime'>>): Promise<LogicalModel> {
  const db = getDb()
  const time = now()
  const existing = db.select().from(logicalModels).where(eq(logicalModels.id, id)).get()
  if (!existing) throw new Error(`logical model not found: ${id}`)
  db.update(logicalModels)
    .set({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
      ...(updates.deletedTime !== undefined ? { deletedTime: updates.deletedTime } : {}),
      updatedTime: time,
    })
    .where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime)))
    .run()
  const row = db.select().from(logicalModels).where(eq(logicalModels.id, id)).get()
  return mapLogicalModel(row!)
}

export async function deleteLogicalModel(id: string): Promise<void> {
  const time = now()
  const db = getDb()
  // 上游模型全局共享，删除逻辑模型不再级联删除上游模型
  db.update(logicalModels)
    .set({ deletedTime: time, updatedTime: time })
    .where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime)))
    .run()
}

// ========== Scheduling Policy ========== 

function mapSchedulingPolicy(row: typeof schedulingPolicies.$inferSelect): SchedulingPolicy {
  return { ...row }
}

export async function listSchedulingPolicies(logicalModelId?: string): Promise<SchedulingPolicy[]> {
  const condition = logicalModelId ? eq(schedulingPolicies.logicalModelId, logicalModelId) : undefined
  return getDb().select().from(schedulingPolicies)
    .where(condition)
    .orderBy(schedulingPolicies.priority, schedulingPolicies.weight)
    .all()
    .map(mapSchedulingPolicy)
}

export type UpsertSchedulingPolicyInput = Pick<SchedulingPolicy, 'logicalModelId' | 'providerModelId'> & Partial<Pick<SchedulingPolicy, 'strategy' | 'priority' | 'weight' | 'enabled' | 'failoverEnabled'>>

export async function upsertSchedulingPolicy(input: UpsertSchedulingPolicyInput): Promise<SchedulingPolicy> {
  const time = now()
  const values = {
    logicalModelId: input.logicalModelId,
    providerModelId: input.providerModelId,
    strategy: input.strategy ?? 'priority',
    priority: input.priority ?? 0,
    weight: input.weight ?? 100,
    enabled: input.enabled ?? true,
    failoverEnabled: input.failoverEnabled ?? true,
    createdTime: time,
    updatedTime: time,
  }
  getDb().insert(schedulingPolicies).values(values).onConflictDoUpdate({
    target: [schedulingPolicies.logicalModelId, schedulingPolicies.providerModelId],
    set: { strategy: values.strategy, priority: values.priority, weight: values.weight, enabled: values.enabled, failoverEnabled: values.failoverEnabled, updatedTime: time },
  }).run()
  return mapSchedulingPolicy(getDb().select().from(schedulingPolicies).where(and(eq(schedulingPolicies.logicalModelId, input.logicalModelId), eq(schedulingPolicies.providerModelId, input.providerModelId))).get()!)
}

export async function deleteSchedulingPolicy(logicalModelId: string, providerModelId: string): Promise<void> {
  getDb().delete(schedulingPolicies).where(and(eq(schedulingPolicies.logicalModelId, logicalModelId), eq(schedulingPolicies.providerModelId, providerModelId))).run()
}

// ========== Provider Model ========== 

export interface ProviderModelView extends ProviderModel {
  endpoints: Array<ProviderModelEndpointView>
}

export interface ProviderModelEndpointView extends ProviderModelEndpoint {
  protocol: ProviderModelRouteEndpoint['protocol']
  conversions: ProtocolConverter[]
}

export async function listProviderModels(includeDeleted = false): Promise<ProviderModelView[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelView)
}

export async function listProviderModelsForLogicalModel(logicalModelId: string, includeDeleted = false): Promise<ProviderModelRoute[]> {
  const rows = getDb().select({ model: providerModels, policy: schedulingPolicies })
    .from(schedulingPolicies)
    .innerJoin(providerModels, eq(schedulingPolicies.providerModelId, providerModels.id))
    .where(and(eq(schedulingPolicies.logicalModelId, logicalModelId), eq(schedulingPolicies.enabled, true)))
    .orderBy(schedulingPolicies.priority, schedulingPolicies.weight)
    .all()
  return rows
    .filter(({ model, policy }) => (includeDeleted || model.deletedTime === null) && model.enabled && policy.enabled)
    .map(({ model, policy }) => ({ ...mapProviderModel(model), priority: policy.priority }))
}

export async function getProviderModel(id: string): Promise<ProviderModelView | undefined> {
  const row = getDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelView(row) : undefined
}

// ========== Provider Model compatibility surface ==========

export async function listProviderModelRoutesByProvider(providerId: string, includeDeleted = false): Promise<ProviderModelRoute[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? eq(providerModels.providerId, providerId) : and(eq(providerModels.providerId, providerId), isNull(providerModels.deletedTime)))
    .orderBy(providerModels.createdTime).all()
  return rows.map(row => mapProviderModel(row))
}

export async function listProviderModelRoutes(includeDeleted = true): Promise<ProviderModelRoute[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(row => mapProviderModel(row))
}

export async function getProviderModelRoute(id: string): Promise<ProviderModelRoute | undefined> {
  const row = getDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModel(row) : undefined
}

type CreateProviderModelRouteInput = Pick<ProviderModelRoute, 'providerId' | 'modelName' | 'priority'> & Partial<Pick<ProviderModelRoute, 'endpoints' | 'enabled'>>

export async function createProviderModelRoute(input: CreateProviderModelRouteInput): Promise<ProviderModelRoute> {
  const id = generateId('model_')
  const time = now()
  const db = getDb()
  db.transaction(transaction => {
    transaction.insert(providerModels).values({ id, providerId: input.providerId, modelName: input.modelName, enabled: input.enabled ?? true, createdTime: time, updatedTime: time }).run()
    transaction.insert(providerModelHealth).values({ providerModelId: id, updatedTime: time }).run()
    for (const endpoint of input.endpoints ?? []) {
      const endpointRow = transaction.select().from(providerEndpoints).where(and(eq(providerEndpoints.providerId, input.providerId), eq(providerEndpoints.protocol, endpoint.protocol))).get()
      const endpointId = endpointRow?.id ?? generateId('end_')
      if (!endpointRow) transaction.insert(providerEndpoints).values({ id: endpointId, providerId: input.providerId, protocol: endpoint.protocol, url: endpoint.upstreamUrl || 'https://invalid.local', createdTime: time, updatedTime: time }).run()
      transaction.insert(providerModelEndpoints).values({ id: generateId('pme_'), providerModelId: id, providerEndpointId: endpointId, url: endpoint.upstreamUrl || null, enabled: true, createdTime: time, updatedTime: time }).run()
    }
  })
  return { id, providerId: input.providerId, modelName: input.modelName, endpoints: input.endpoints ?? [], priority: input.priority, enabled: input.enabled ?? true, createdTime: time, updatedTime: time, deletedTime: null }
}

export async function updateProviderModelRoute(id: string, updates: Partial<Omit<ProviderModelRoute, 'id' | 'createdTime'>>): Promise<ProviderModelRoute> {
  const time = now()
  const db = getDb()
  const existing = await getProviderModelRoute(id)
  if (!existing) throw new Error(`provider model not found: ${id}`)
  db.transaction(transaction => {
    transaction.update(providerModels).set({ ...(updates.providerId !== undefined ? { providerId: updates.providerId } : {}), ...(updates.modelName !== undefined ? { modelName: updates.modelName } : {}), ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}), ...(updates.deletedTime !== undefined ? { deletedTime: updates.deletedTime } : {}), updatedTime: time }).where(eq(providerModels.id, id)).run()
    if (updates.endpoints !== undefined) {
      transaction.delete(protocolConverters).where(sql`providerModelEndpointId IN (SELECT id FROM provider_model_endpoints WHERE providerModelId = ${id})`).run()
      transaction.delete(providerModelEndpoints).where(eq(providerModelEndpoints.providerModelId, id)).run()
      for (const endpoint of updates.endpoints) {
        const endpointRow = transaction.select().from(providerEndpoints).where(and(eq(providerEndpoints.providerId, existing.providerId), eq(providerEndpoints.protocol, endpoint.protocol))).get()
        const endpointId = endpointRow?.id ?? generateId('end_')
        if (!endpointRow) transaction.insert(providerEndpoints).values({ id: endpointId, providerId: existing.providerId, protocol: endpoint.protocol, url: endpoint.upstreamUrl || 'https://invalid.local', createdTime: time, updatedTime: time }).run()
        const bindingId = generateId('pme_')
        transaction.insert(providerModelEndpoints).values({ id: bindingId, providerModelId: id, providerEndpointId: endpointId, url: endpoint.upstreamUrl || null, enabled: true, createdTime: time, updatedTime: time }).run()
        if (endpoint.protocolConversionEnabled) transaction.insert(protocolConverters).values({ id: generateId('conv_'), providerModelEndpointId: bindingId, clientProtocol: endpoint.protocol, enabled: true, createdTime: time, updatedTime: time }).run()
      }
    }
  })
  return { ...existing, ...updates, id, updatedTime: time }
}

export async function deleteProviderModelRoute(id: string): Promise<void> {
  const time = now()
  getDb().update(providerModels).set({ enabled: false, deletedTime: time, updatedTime: time }).where(and(eq(providerModels.id, id), isNull(providerModels.deletedTime))).run()
}

// ========== Provider Health ==========

export async function getProviderHealth(providerId: string): Promise<ProviderHealth | undefined> {
  const row = getDb()
    .select()
    .from(providerHealth)
    .where(eq(providerHealth.providerId, providerId))
    .get()
  return row ? mapHealth(row) : undefined
}

export async function listProviderHealth(): Promise<ProviderHealth[]> {
  const rows = getDb().select().from(providerHealth).all()
  return rows.map(mapHealth)
}

export async function recordHealthSuccess(providerId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerHealth)
    .set({
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: time,
      updatedTime: time,
    })
    .where(eq(providerHealth.providerId, providerId))
    .run()
}

export async function recordProviderFailure(providerId: string, consecutiveFailureThreshold: number, cooldownBaseSeconds: number, cooldownMaxSeconds: number): Promise<void> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    const current = transaction
      .select()
      .from(providerHealth)
      .where(eq(providerHealth.providerId, providerId))
      .get()
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1
    let cooldownUntilTime: number | null = null
    if (consecutiveFailures >= consecutiveFailureThreshold) {
      const exponent = consecutiveFailures - consecutiveFailureThreshold
      const seconds = Math.min(cooldownBaseSeconds * Math.pow(2, exponent), cooldownMaxSeconds)
      cooldownUntilTime = time + seconds * 1000
    }

    transaction
      .update(providerHealth)
      .set({
        consecutiveFailures,
        cooldownUntilTime,
        lastFailureTime: time,
        updatedTime: time,
      })
      .where(eq(providerHealth.providerId, providerId))
      .run()
  })
}

export async function resetProviderHealth(providerId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerHealth)
    .set({
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: null,
      lastFailureTime: null,
      updatedTime: time,
    })
    .where(eq(providerHealth.providerId, providerId))
    .run()
}

// ========== Provider Model Health ==========

export async function getProviderModelHealth(providerModelId: string): Promise<ProviderModelHealthRow | undefined> {
  return getDb()
    .select()
    .from(providerModelHealth)
    .where(eq(providerModelHealth.providerModelId, providerModelId))
    .get()
}

export async function recordProviderModelHealthSuccess(providerModelId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerModelHealth)
    .set({
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: time,
      updatedTime: time,
    })
    .where(eq(providerModelHealth.providerModelId, providerModelId))
    .run()
}

export async function recordProviderModelFailure(providerModelId: string, consecutiveFailureThreshold: number, cooldownBaseSeconds: number, cooldownMaxSeconds: number): Promise<void> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    const current = transaction
      .select()
      .from(providerModelHealth)
      .where(eq(providerModelHealth.providerModelId, providerModelId))
      .get()
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1
    let cooldownUntilTime: number | null = null
    if (consecutiveFailures >= consecutiveFailureThreshold) {
      const exponent = consecutiveFailures - consecutiveFailureThreshold
      const seconds = Math.min(cooldownBaseSeconds * Math.pow(2, exponent), cooldownMaxSeconds)
      cooldownUntilTime = time + seconds * 1000
    }

    transaction
      .update(providerModelHealth)
      .set({
        consecutiveFailures,
        cooldownUntilTime,
        lastFailureTime: time,
        updatedTime: time,
      })
      .where(eq(providerModelHealth.providerModelId, providerModelId))
      .run()
  })
}

export async function resetProviderModelHealth(providerModelId: string): Promise<void> {
  const time = now()
  getDb()
    .update(providerModelHealth)
    .set({
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: null,
      lastFailureTime: null,
      updatedTime: time,
    })
    .where(eq(providerModelHealth.providerModelId, providerModelId))
    .run()
}

// ========== Settings ==========

export interface SettingsDefaults {
  listenPort: number
}

const PRODUCTION_SETTINGS_DEFAULTS: SettingsDefaults = {
  listenPort: 9300,
}

/** SettingsSchema 除 id/updatedTime 外的字段，即需要持久化的键 */
const SETTINGS_KEYS = Object.keys(SettingsSchema.shape).filter(
  key => key !== 'id' && key !== 'updatedTime',
)

function parseStoredValue(key: string, raw: string | undefined): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    console.warn(`[store] settings key "${key}" has invalid JSON, ignoring`, raw)
    return undefined
  }
}

export async function getSettings(defaults = PRODUCTION_SETTINGS_DEFAULTS): Promise<Settings> {
  const db = getDb()
  const rows = db.select().from(settings).all()
  const stored = new Map(rows.map(row => [row.key, row.value]))
  const parsed: Record<string, unknown> = {}
  for (const key of SETTINGS_KEYS) {
    const value = parseStoredValue(key, stored.get(key))
    if (value !== undefined) parsed[key] = value
  }
  return SettingsSchema.parse({
    id: 'singleton',
    ...parsed,
    listenPort: parsed.listenPort ?? defaults.listenPort,
    updatedTime: now(),
  })
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id' | 'updatedTime'>>,
): Promise<Settings> {
  const db = getDb()
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue
    db.insert(settings)
      .values({ key, value: JSON.stringify(value), valueType: typeof value, updatedTime: now() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(value), valueType: typeof value, updatedTime: now() },
      })
      .run()
  }
  const result = await getSettings()
  notifySettingsChanged(result)
  return result
}

// ========== Request Log ==========

type CreateRequestLogInput = Omit<RequestLog, 'id' | 'createdTime'> & { id?: string }

export async function createRequestLog(input: CreateRequestLogInput): Promise<RequestLog> {
  const id = input.id ?? generateId('req_')
  const time = now()
  getDb()
    .insert(requestLogs)
    .values({
      id,
      logicalModelId: input.logicalModelId,
      protocol: input.protocol,
      status: input.status,
      metadata: null,
      createdTime: time,
    })
    .run()
  getDb().insert(requestMetrics).values({ requestId: id, key: 'durationMilliseconds', value: input.totalDurationMilliseconds, unit: 'milliseconds', updatedTime: time }).run()
  if (input.totalTokens != null) getDb().insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type: 'totalTokens', value: input.totalTokens, unit: 'tokens', createdTime: time }).run()
  return {
    id,
    logicalModelId: input.logicalModelId,
    protocol: input.protocol,
    upstreamProtocol: input.upstreamProtocol ?? null,
    status: input.status,
    totalDurationMilliseconds: input.totalDurationMilliseconds,
    totalTokens: input.totalTokens ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    cachedInputTokens: input.cachedInputTokens ?? null,
    cacheCreationInputTokens: input.cacheCreationInputTokens ?? null,
    promptCacheHit: input.promptCacheHit ?? null,
    rawUsage: input.rawUsage ?? null,
    ttftMilliseconds: input.ttftMilliseconds ?? null,
    cacheHit: input.cacheHit ?? null,
    createdTime: time,
  }
}

export interface RequestLogUpdate {
  status?: RequestStatus
  upstreamProtocol?: RequestLog['upstreamProtocol']
  totalDurationMilliseconds?: number
  totalTokens?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  promptCacheHit?: boolean | null
  rawUsage?: RequestLog['rawUsage']
  ttftMilliseconds?: number | null
  cacheHit?: boolean | null
}

export async function updateRequestLogStatus(id: string, update: RequestLogUpdate): Promise<void> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    if (update.status !== undefined) transaction.update(requestLogs).set({ status: update.status }).where(eq(requestLogs.id, id)).run()
    const metrics: Array<{ key: string; value: number; unit: string }> = []
    if (update.totalDurationMilliseconds !== undefined) metrics.push({ key: 'durationMilliseconds', value: update.totalDurationMilliseconds, unit: 'milliseconds' })
    const optionalMetrics: Array<[keyof RequestLogUpdate, string, string]> = [
      ['ttftMilliseconds', 'ttftMilliseconds', 'milliseconds'],
      ['inputTokens', 'inputTokens', 'tokens'],
      ['outputTokens', 'outputTokens', 'tokens'],
      ['cachedInputTokens', 'cachedInputTokens', 'tokens'],
      ['cacheCreationInputTokens', 'cacheCreationInputTokens', 'tokens'],
    ]
    for (const [field, key, unit] of optionalMetrics) {
      const value = update[field]
      if (value === null) transaction.delete(requestMetrics).where(and(eq(requestMetrics.requestId, id), eq(requestMetrics.key, key))).run()
      else if (value !== undefined) metrics.push({ key, value: value as number, unit })
    }
    for (const [field, key] of [['promptCacheHit', 'promptCacheHit'], ['cacheHit', 'cacheHit']] as const) {
      const value = update[field]
      if (value === null) transaction.delete(requestMetrics).where(and(eq(requestMetrics.requestId, id), eq(requestMetrics.key, key))).run()
      else if (value !== undefined) metrics.push({ key, value: value ? 1 : 0, unit: 'boolean' })
    }
    for (const metric of metrics) transaction.insert(requestMetrics).values({ requestId: id, ...metric, updatedTime: time }).onConflictDoUpdate({ target: [requestMetrics.requestId, requestMetrics.key], set: { value: metric.value, unit: metric.unit, updatedTime: time } }).run()
    if (update.totalTokens !== undefined) {
      transaction.delete(requestUsages).where(and(eq(requestUsages.requestId, id), eq(requestUsages.type, 'totalTokens'))).run()
      if (update.totalTokens !== null) transaction.insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type: 'totalTokens', value: update.totalTokens, unit: 'tokens', createdTime: time }).run()
    }
    if (update.rawUsage !== undefined) {
      transaction.delete(requestUsages).where(and(eq(requestUsages.requestId, id), eq(requestUsages.type, 'raw'))).run()
      if (update.rawUsage !== null) transaction.insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type: 'raw', value: 0, unit: serializeRawUsage(update.rawUsage) ?? '', createdTime: time }).run()
    }
  })
}

export interface RequestLogFilter {
  providerId?: string
  protocol?: string
  status?: RequestStatus
}

function requestLogFilterConditions(filter?: RequestLogFilter) {
  if (!filter) return []
  const conditions = []
  if (filter.providerId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${requestAttempts} a WHERE a.requestId = ${requestLogs.id} AND a.providerId = ${filter.providerId})`,
    )
  }
  if (filter.protocol) conditions.push(eq(requestLogs.protocol, filter.protocol))
  if (filter.status) conditions.push(eq(requestLogs.status, filter.status))
  return conditions
}

export async function listRequestLogs(limit = 50, offset = 0, filter?: RequestLogFilter): Promise<RequestLog[]> {
  const conditions = requestLogFilterConditions(filter)
  const rows = getDb()
    .select()
    .from(requestLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(requestLogs.createdTime))
    .limit(limit)
    .offset(offset)
    .all()
  return rows.map(mapRequestLog)
}

export async function getRequestLog(id: string): Promise<RequestLog | null> {
  const row = getDb().select().from(requestLogs).where(eq(requestLogs.id, id)).get()
  return row ? mapRequestLog(row) : null
}

export async function countRequestLogs(filter?: RequestLogFilter): Promise<number> {
  const conditions = requestLogFilterConditions(filter)
  const row = getDb()
    .select({ count: sql<number>`count(*)` })
    .from(requestLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .all()[0]
  return row?.count ?? 0
}

export async function pruneRequestLogs(retentionCount: number, retentionDays: number | null = null): Promise<void> {
  if ((!Number.isInteger(retentionCount) || retentionCount < 1) && (retentionDays == null || !Number.isInteger(retentionDays) || retentionDays < 1)) return
  const db = getDb()
  db.transaction(transaction => {
    const allRows = transaction
      .select({ id: requestLogs.id, createdTime: requestLogs.createdTime })
      .from(requestLogs)
      .orderBy(desc(requestLogs.createdTime))
      .all()
    const countStaleIds = Number.isInteger(retentionCount) && retentionCount > 0
      ? allRows.slice(retentionCount).map(row => row.id)
      : []
    const cutoffTime = retentionDays != null && Number.isInteger(retentionDays) && retentionDays > 0
      ? Date.now() - retentionDays * 24 * 60 * 60 * 1000
      : null
    const ageStaleIds = cutoffTime == null
      ? []
      : allRows.filter(row => row.createdTime < cutoffTime).map(row => row.id)
    const staleIds = [...new Set([...countStaleIds, ...ageStaleIds])]
    if (staleIds.length === 0) return
    transaction.delete(requestContents).where(inArray(requestContents.requestId, staleIds)).run()
    transaction.delete(requestUsages).where(inArray(requestUsages.requestId, staleIds)).run()
    transaction.delete(requestMetrics).where(inArray(requestMetrics.requestId, staleIds)).run()
    transaction.delete(requestAttempts).where(inArray(requestAttempts.requestId, staleIds)).run()
    transaction.delete(requestLogs).where(inArray(requestLogs.id, staleIds)).run()
  })
}

export async function pruneRequestLogsBefore(retentionDays: number): Promise<number> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) return 0
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const db = getDb()
  return db.transaction(transaction => {
    const staleRows = transaction
      .select({ id: requestLogs.id })
      .from(requestLogs)
      .where(sql`${requestLogs.createdTime} < ${cutoffTime}`)
      .all()
    const staleIds = staleRows.map(row => row.id)
    if (staleIds.length === 0) return 0
    transaction.delete(requestContents).where(inArray(requestContents.requestId, staleIds)).run()
    transaction.delete(requestUsages).where(inArray(requestUsages.requestId, staleIds)).run()
    transaction.delete(requestMetrics).where(inArray(requestMetrics.requestId, staleIds)).run()
    transaction.delete(requestAttempts).where(inArray(requestAttempts.requestId, staleIds)).run()
    transaction.delete(requestLogs).where(inArray(requestLogs.id, staleIds)).run()
    return staleIds.length
  })
}

type CreateRequestAttemptInput = Omit<RequestAttempt, 'id' | 'createdTime' | 'errorCode' | 'errorMessage' | 'details'>
  & Partial<Pick<RequestAttempt, 'errorCode' | 'errorMessage' | 'details'>>

export async function createRequestAttempt(input: CreateRequestAttemptInput): Promise<RequestAttempt> {
  const id = generateId('att_')
  const time = now()
  getDb()
    .insert(requestAttempts)
    .values({
      id,
      requestId: input.requestId,
      providerId: input.providerId,
      providerModelId: input.providerModelId,
      providerName: input.providerName,
      providerModelName: input.providerModelName,
      providerProtocol: input.providerProtocol,
      providerRequestId: input.providerRequestId,
      url: input.url,
      status: input.status,
      httpStatus: input.httpStatus,
      retryable: input.retryable,
      attemptIndex: input.attemptIndex,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      details: input.details ?? null,
      durationMilliseconds: input.durationMilliseconds,
      createdTime: time,
    })
    .run()
  return {
    id,
    ...input,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    details: input.details ?? null,
    createdTime: time,
  }
}

type CreateRequestContentInput = Omit<RequestContent, 'id' | 'createdTime' | 'updatedTime'>

export async function createRequestContent(input: CreateRequestContentInput): Promise<RequestContent> {
  const id = generateId('content_')
  const time = now()
  getDb().insert(requestContents).values({ id, ...input, createdTime: time, updatedTime: time }).run()
  return { id, ...input, createdTime: time, updatedTime: time }
}

type UpdateRequestContentInput = Partial<Pick<RequestContent,
  'captureStatus' | 'responseStatus' | 'responseHeaders' | 'responseBody' | 'conversions'
>>

export async function updateRequestContent(id: string, input: UpdateRequestContentInput): Promise<void> {
  getDb().update(requestContents).set({ ...input, updatedTime: now() }).where(eq(requestContents.id, id)).run()
}

export async function listRequestContents(requestId: string): Promise<RequestContent[]> {
  return getDb().select().from(requestContents).where(eq(requestContents.requestId, requestId)).orderBy(requestContents.createdTime).all()
    .map(mapRequestContent)
}

function mapRequestContent(row: typeof requestContents.$inferSelect): RequestContent {
  return {
    id: row.id,
    requestId: row.requestId,
    attemptId: row.attemptId,
    captureStatus: row.captureStatus as RequestContentCaptureStatus,
    requestMethod: row.requestMethod,
    requestPath: row.requestPath,
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    responseStatus: row.responseStatus,
    responseHeaders: row.responseHeaders,
    responseBody: row.responseBody,
    conversions: row.conversions,
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  }
}

export async function listAttemptsByRequest(requestId: string): Promise<RequestAttempt[]> {
  const rows = getDb()
    .select()
    .from(requestAttempts)
    .where(eq(requestAttempts.requestId, requestId))
    .orderBy(requestAttempts.attemptIndex)
    .all()
  return rows.map(mapRequestAttempt)
}

// ========== Analytics / Statistics ==========

export interface StatsSummary {
  totalRequests: number
  successCount: number
  failedCount: number
  successRate: number
  avgLatencyMs: number
  totalTokens: number
}

export async function getStatsSummary(sinceMs: number): Promise<StatsSummary> {
  const db = getDb()
  const result = db
    .select({
      total: sql<number>`count(*)`.as('total'),
      success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
      failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
      avgLatency: sql<number>`avg((SELECT value FROM request_metrics m WHERE m.requestId = ${requestLogs.id} AND m.key = 'durationMilliseconds'))`.as('avgLatency'),
    })
    .from(requestLogs)
    .where(sql`${requestLogs.createdTime} >= ${sinceMs}`)
    .get()
  const usageResult = db
    .select({ tokens: sql<number>`coalesce(sum(${requestUsages.value}), 0)`.as('tokens') })
    .from(requestUsages)
    .innerJoin(requestLogs, eq(requestUsages.requestId, requestLogs.id))
    .where(and(eq(requestUsages.type, 'totalTokens'), sql`${requestLogs.createdTime} >= ${sinceMs}`))
    .get()
  const total = result?.total ?? 0
  const success = result?.success ?? 0
  const failed = result?.failed ?? 0
  return {
    totalRequests: total,
    successCount: success,
    failedCount: failed,
    successRate: total > 0 ? success / total : 0,
    avgLatencyMs: result?.avgLatency ?? 0,
    totalTokens: usageResult?.tokens ?? 0,
  }
}

export interface DailyTrendPoint {
  day: string // YYYY-MM-DD
  requests: number
  success: number
  failed: number
}

export async function getRequestTrend(sinceMs: number, days: number): Promise<DailyTrendPoint[]> {
  const db = getDb()
  const rows = db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`.as('day'),
      requests: sql<number>`count(*)`.as('requests'),
      success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
      failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
    })
    .from(requestLogs)
    .where(sql`${requestLogs.createdTime} >= ${sinceMs}`)
    .groupBy(sql`day`)
    .orderBy(sql`day`)
    .all()

  // 填充没有数据的天
  const map = new Map(rows.map(r => [r.day, r]))
  const result: DailyTrendPoint[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = formatLocalDate(d)
    const row = map.get(key)
    result.push({
      day: key,
      requests: row?.requests ?? 0,
      success: row?.success ?? 0,
      failed: row?.failed ?? 0,
    })
  }
  return result
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface ProviderStat {
  providerId: string
  providerName: string
  requests: number
  success: number
  failed: number
  avgLatencyMs: number
}

export async function getProviderStats(sinceMs: number): Promise<ProviderStat[]> {
  const db = getDb()
  // 每个请求只归属最后一次尝试的 Provider，避免故障转移导致请求量重复计算。
  const finalAttempt = sql`${requestAttempts.attemptIndex} = (
    SELECT max(final_attempt.attemptIndex)
    FROM request_attempts AS final_attempt
    WHERE final_attempt.requestId = ${requestAttempts.requestId}
  )`
  const rows = db
    .select({
      providerId: requestAttempts.providerId,
      providerName: providers.name,
      requests: sql<number>`count(distinct ${requestAttempts.requestId})`.as('requests'),
      success: sql<number>`count(distinct case when ${requestAttempts.status} = 'success' then ${requestAttempts.requestId} end)`.as('success'),
      failed: sql<number>`count(distinct case when ${requestAttempts.status} = 'failed' then ${requestAttempts.requestId} end)`.as('failed'),
      avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
    })
    .from(requestAttempts)
    .innerJoin(providers, eq(requestAttempts.providerId, providers.id))
    .where(and(sql`${requestAttempts.createdTime} >= ${sinceMs}`, finalAttempt))
    .groupBy(requestAttempts.providerId)
    .orderBy(sql`requests desc`)
    .all()

  return rows.map(r => ({
    providerId: r.providerId,
    providerName: r.providerName,
    requests: r.requests ?? 0,
    success: r.success ?? 0,
    failed: r.failed ?? 0,
    avgLatencyMs: r.avgLatency ?? 0,
  }))
}

export interface ModelStat {
  upstreamModelId: string
  providerId: string
  providerName: string
  requests: number
  success: number
  avgLatencyMs: number
}

export async function getModelStats(sinceMs: number, limit = 10): Promise<ModelStat[]> {
  const db = getDb()
  const finalAttempt = sql`${requestAttempts.attemptIndex} = (
    SELECT max(final_attempt.attemptIndex)
    FROM request_attempts AS final_attempt
    WHERE final_attempt.requestId = ${requestAttempts.requestId}
  )`
  const rows = db
    .select({
      upstreamModelId: requestAttempts.providerModelName,
      providerId: requestAttempts.providerId,
      providerName: providers.name,
      requests: sql<number>`count(distinct ${requestAttempts.requestId})`.as('requests'),
      success: sql<number>`count(distinct case when ${requestAttempts.status} = 'success' then ${requestAttempts.requestId} end)`.as('success'),
      avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
    })
    .from(requestAttempts)
    .innerJoin(providers, eq(requestAttempts.providerId, providers.id))
    .where(and(sql`${requestAttempts.createdTime} >= ${sinceMs}`, finalAttempt))
    .groupBy(requestAttempts.providerModelName, requestAttempts.providerId)
    .orderBy(sql`requests desc`)
    .limit(limit)
    .all()

  return rows.map(r => ({
    upstreamModelId: r.upstreamModelId,
    providerId: r.providerId,
    providerName: r.providerName,
    requests: r.requests ?? 0,
    success: r.success ?? 0,
    avgLatencyMs: r.avgLatency ?? 0,
  }))
}

export interface LatencyBucket {
  range: string
  count: number
}

export async function getLatencyDistribution(sinceMs: number): Promise<LatencyBucket[]> {
  const db = getDb()
  const buckets = [
    { range: '< 1s', min: 0, max: 1000 },
    { range: '1-2s', min: 1000, max: 2000 },
    { range: '2-3s', min: 2000, max: 3000 },
    { range: '3-5s', min: 3000, max: 5000 },
    { range: '> 5s', min: 5000, max: Number.MAX_SAFE_INTEGER },
  ]
  const result: LatencyBucket[] = []
  for (const b of buckets) {
    const row = db
      .select({ count: sql<number>`count(*)`.as('count') })
      .from(requestLogs)
      .where(sql`${requestLogs.createdTime} >= ${sinceMs} and (SELECT value FROM request_metrics m WHERE m.requestId = ${requestLogs.id} AND m.key = 'durationMilliseconds') >= ${b.min} and (SELECT value FROM request_metrics m WHERE m.requestId = ${requestLogs.id} AND m.key = 'durationMilliseconds') < ${b.max}`)
      .get()
    result.push({ range: b.range, count: row?.count ?? 0 })
  }
  return result
}

export interface FailureReasonStat {
  reason: string
  count: number
}

export async function getFailureReasons(sinceMs: number): Promise<FailureReasonStat[]> {
  const db = getDb()
  const finalAttempt = sql`${requestAttempts.attemptIndex} = (
    SELECT max(final_attempt.attemptIndex)
    FROM request_attempts AS final_attempt
    WHERE final_attempt.requestId = ${requestAttempts.requestId}
  )`
  // 按最终失败 attempt 分类，确保原因总数与失败请求数一致。
  const rows = db
    .select({
      errorCode: requestAttempts.errorCode,
      count: sql<number>`count(distinct ${requestAttempts.requestId})`.as('count'),
    })
    .from(requestAttempts)
    .where(and(
      sql`${requestAttempts.createdTime} >= ${sinceMs}`,
      eq(requestAttempts.status, 'failed'),
      finalAttempt,
    ))
    .groupBy(requestAttempts.errorCode)
    .orderBy(sql`count desc`)
    .all()

  // 归类到友好名称
  const categories: Record<string, number> = {
    '超时': 0,
    '限流 (429)': 0,
    '服务错误 (5xx)': 0,
    '认证失败': 0,
    '其他': 0,
  }
  for (const row of rows) {
    const code = row.errorCode ?? 'UNKNOWN'
    if (code.includes('TIMEOUT') || code.includes('ECONNRESET') || code.includes('ETIMEDOUT')) {
      categories['超时'] += row.count
    } else if (code.includes('429') || code.includes('RATE_LIMIT')) {
      categories['限流 (429)'] += row.count
    } else if (/Status_5\d\d/.test(code) || code.includes('UPSTREAM_ERROR') || code.includes('SERVER_ERROR')) {
      categories['服务错误 (5xx)'] += row.count
    } else if (code.includes('401') || code.includes('403') || code.includes('AUTH')) {
      categories['认证失败'] += row.count
    } else {
      categories['其他'] += row.count
    }
  }
  return Object.entries(categories)
    .map(([reason, count]) => ({ reason, count }))
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count)
}

// ========== Row mappers ==========

function mapProvider(row: typeof providers.$inferSelect): Provider {
  const settingRows = getDb().select().from(providerSettings).where(eq(providerSettings.providerId, row.id)).all()
  const values = new Map(settingRows.map(setting => [setting.key, setting.value]))
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    apiKeyReference: values.get('security.secretReference') ?? '',
    timeoutMilliseconds: Number(values.get('connection.timeoutMilliseconds') ?? 30000),
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

function mapLogicalModel(row: typeof logicalModels.$inferSelect): LogicalModel {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

function mapProviderModelView(row: typeof providerModels.$inferSelect): ProviderModelView {
  const endpointRows = getDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), eq(providerEndpoints.enabled, true))).all()
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
    endpoints: endpointRows.map(({ endpoint, binding }) => ({
      id: binding.id,
      providerModelId: binding.providerModelId,
      providerEndpointId: binding.providerEndpointId,
      url: binding.url,
      enabled: binding.enabled,
      createdTime: Number(binding.createdTime),
      updatedTime: Number(binding.updatedTime),
      protocol: endpoint.protocol as ProviderModelRouteEndpoint['protocol'],
      conversions: getDb().select().from(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, binding.id)).all().map(converter => ({
        id: converter.id,
        providerModelEndpointId: converter.providerModelEndpointId,
        clientProtocol: converter.clientProtocol as ProtocolConverter['clientProtocol'],
        enabled: converter.enabled,
        createdTime: Number(converter.createdTime),
        updatedTime: Number(converter.updatedTime),
      })),
    })),
  }
}

function mapProviderModel(row: typeof providerModels.$inferSelect): ProviderModelRoute {
  const endpointRows = getDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), eq(providerEndpoints.enabled, true))).all()
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    endpoints: endpointRows.map(({ endpoint, binding }) => ({ protocol: endpoint.protocol as ProviderModelRouteEndpoint['protocol'], upstreamUrl: binding.url ?? endpoint.url, customAuthHeader: null, protocolConversionEnabled: false })),
    priority: 0,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

function mapHealth(row: typeof providerHealth.$inferSelect): ProviderHealth {
  return {
    providerId: row.providerId,
    consecutiveFailures: row.consecutiveFailures,
    cooldownUntilTime: row.cooldownUntilTime === null ? null : Number(row.cooldownUntilTime),
    lastSuccessTime: row.lastSuccessTime === null ? null : Number(row.lastSuccessTime),
    lastFailureTime: row.lastFailureTime === null ? null : Number(row.lastFailureTime),
    updatedTime: Number(row.updatedTime),
  }
}

function serializeRawUsage(rawUsage: RequestLog['rawUsage'] | undefined): string | null {
  return rawUsage == null ? null : JSON.stringify(rawUsage)
}

function parseRawUsage(rawUsage: string | null | undefined): RequestLog['rawUsage'] {
  if (!rawUsage) return null
  try {
    const parsed = JSON.parse(rawUsage)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as RequestLog['rawUsage']
      : null
  } catch {
    return null
  }
}

function mapRequestLog(row: typeof requestLogs.$inferSelect): RequestLog {
  const metrics = new Map(getDb().select().from(requestMetrics).where(eq(requestMetrics.requestId, row.id)).all().map(metric => [metric.key, metric]))
  const usages = getDb().select().from(requestUsages).where(eq(requestUsages.requestId, row.id)).all()
  const raw = usages.find(usage => usage.type === 'raw')
  const totalTokens = usages.find(usage => usage.type === 'totalTokens')
  const metricValue = (key: string) => metrics.get(key)?.value ?? null
  return {
    id: row.id,
    logicalModelId: row.logicalModelId,
    protocol: row.protocol as RequestLog['protocol'],
    upstreamProtocol: null,
    status: row.status as RequestStatus,
    totalDurationMilliseconds: Number(metricValue('durationMilliseconds') ?? 0),
    totalTokens: totalTokens?.value ?? null,
    inputTokens: metricValue('inputTokens'),
    outputTokens: metricValue('outputTokens'),
    cachedInputTokens: metricValue('cachedInputTokens'),
    cacheCreationInputTokens: metricValue('cacheCreationInputTokens'),
    promptCacheHit: metricValue('promptCacheHit') == null ? null : metricValue('promptCacheHit') === 1,
    rawUsage: parseRawUsage(raw?.unit),
    ttftMilliseconds: metricValue('ttftMilliseconds'),
    cacheHit: metricValue('cacheHit') == null ? null : metricValue('cacheHit') === 1,
    createdTime: Number(row.createdTime),
  }
}

function mapRequestAttempt(row: typeof requestAttempts.$inferSelect): RequestAttempt {
  return {
    id: row.id,
    requestId: row.requestId,
    providerId: row.providerId,
    providerModelId: row.providerModelId,
    providerName: row.providerName,
    providerModelName: row.providerModelName,
    providerProtocol: row.providerProtocol as RequestAttempt['providerProtocol'],
    providerRequestId: row.providerRequestId,
    url: row.url,
    attemptIndex: row.attemptIndex,
    status: row.status as RequestStatus,
    httpStatus: row.httpStatus,
    retryable: row.retryable,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    details: row.details,
    durationMilliseconds: row.durationMilliseconds,
    createdTime: Number(row.createdTime),
  }
}
