import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { ProtocolConverterSchema, ProviderModelEndpointSchema } from '@common/schemas'
import type {
  ProviderModel,
  ProviderModelEndpoint,
  ProtocolConverter,
  ProviderModelRoute,
  ProviderModelRouteEndpoint,
  RequestLog,
  RequestAttempt,
  RequestContent,
  RequestContentCaptureStatus,
  RawUsage,
  RequestStatus,
} from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import {
  providerModels,
  providerEndpoints,
  providerModelEndpoints,
  providerModelHealth,
  protocolConverters,
  requestAttempts,
  requestLogs,
  requestContents,
  requestMetrics,
  requestUsages,
  schedulingPolicies,
} from './schema'

export {
  createProvider,
  createProviderEndpoint,
  deleteProvider,
  deleteProviderEndpoint,
  deleteProviderSetting,
  getProvider,
  getProviderEndpoint,
  getProviderSetting,
  listProviderEndpoints,
  listProviderSettings,
  listProviders,
  replaceProviderEndpoints,
  updateProvider,
  updateProviderEndpoint,
  upsertProviderSetting,
} from './provider-store'

export {
  getProviderHealth,
  getProviderModelHealth,
  listProviderModelHealth,
  listProviderHealth,
  recordHealthSuccess,
  recordProviderFailure,
  recordProviderModelFailure,
  recordProviderModelHealthSuccess,
  resetProviderHealth,
  resetProviderModelHealth,
} from './health-store'

export {
  createLogicalModel,
  deleteLogicalModel,
  deleteSchedulingPolicy,
  getLogicalModel,
  listLogicalModels,
  listSchedulingPolicies,
  updateLogicalModel,
  upsertSchedulingPolicy,
} from './logical-model-store'
export type { UpsertSchedulingPolicyInput } from './logical-model-store'

export { getSettings, onSettingsChanged, updateSettings } from './settings-store'
export type { SettingsDefaults } from './settings-store'
export {
  getFailureReasons,
  getLatencyDistribution,
  getModelStats,
  getProviderStats,
  getRequestTrend,
  getStatsSummary,
} from './analytics-store'
export type {
  DailyTrendPoint,
  FailureReasonStat,
  LatencyBucket,
  ModelStat,
  ProviderStat,
  StatsSummary,
} from './analytics-store'

export interface ProviderModelView extends ProviderModel {
  endpoints: Array<ProviderModelEndpointView>
}

type RequestLogUpdate = import('@common/schemas').RequestLogUpdate

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
    .orderBy(asc(schedulingPolicies.priority), desc(schedulingPolicies.weight), asc(schedulingPolicies.createdTime), asc(schedulingPolicies.providerModelId))
    .all()
  return rows
    .filter(({ model, policy }) => (includeDeleted || model.deletedTime === null) && model.enabled && policy.enabled)
    .map(({ model, policy }) => ({ ...mapProviderModel(model), priority: policy.priority }))
}

export async function getProviderModel(id: string): Promise<ProviderModelView | undefined> {
  const row = getDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelView(row) : undefined
}

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

export async function listProviderModelEndpoints(providerModelId: string): Promise<ProviderModelEndpoint[]> {
  return getDb().select().from(providerModelEndpoints).where(eq(providerModelEndpoints.providerModelId, providerModelId)).orderBy(providerModelEndpoints.createdTime, providerModelEndpoints.id).all().map(row => ProviderModelEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) }))
}

export async function getProviderModelEndpoint(id: string): Promise<ProviderModelEndpoint | undefined> {
  const row = getDb().select().from(providerModelEndpoints).where(eq(providerModelEndpoints.id, id)).get()
  return row ? ProviderModelEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) }) : undefined
}

type CreateProviderModelEndpointInput = Omit<ProviderModelEndpoint, 'id' | 'createdTime' | 'updatedTime' | 'url' | 'enabled'> & { url?: string | null; enabled?: boolean }

export async function createProviderModelEndpoint(input: CreateProviderModelEndpointInput): Promise<ProviderModelEndpoint> {
  const time = now()
  const endpoint = ProviderModelEndpointSchema.parse({ ...input, id: generateId('pme_'), url: input.url ?? null, enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(providerModelEndpoints).values(endpoint).run()
  return endpoint
}

export async function updateProviderModelEndpoint(id: string, updates: Partial<Pick<ProviderModelEndpoint, 'providerEndpointId' | 'url' | 'enabled'>>): Promise<ProviderModelEndpoint> {
  const existing = await getProviderModelEndpoint(id)
  if (!existing) throw new Error(`provider model endpoint not found: ${id}`)
  const endpoint = ProviderModelEndpointSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(providerModelEndpoints).set({ providerEndpointId: endpoint.providerEndpointId, url: endpoint.url, enabled: endpoint.enabled, updatedTime: endpoint.updatedTime }).where(eq(providerModelEndpoints.id, id)).run()
  return endpoint
}

export async function deleteProviderModelEndpoint(id: string): Promise<void> {
  const db = getDb()
  db.transaction(transaction => {
    transaction.delete(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, id)).run()
    transaction.delete(providerModelEndpoints).where(eq(providerModelEndpoints.id, id)).run()
  })
}

export async function listProtocolConverters(providerModelEndpointId: string): Promise<ProtocolConverter[]> {
  return getDb().select().from(protocolConverters).where(eq(protocolConverters.providerModelEndpointId, providerModelEndpointId)).orderBy(protocolConverters.createdTime, protocolConverters.id).all().map(row => ProtocolConverterSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) }))
}

export async function getProtocolConverter(id: string): Promise<ProtocolConverter | undefined> {
  const row = getDb().select().from(protocolConverters).where(eq(protocolConverters.id, id)).get()
  return row ? ProtocolConverterSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) }) : undefined
}

type CreateProtocolConverterInput = Omit<ProtocolConverter, 'id' | 'createdTime' | 'updatedTime' | 'enabled'> & { enabled?: boolean }

export async function createProtocolConverter(input: CreateProtocolConverterInput): Promise<ProtocolConverter> {
  const time = now()
  const converter = ProtocolConverterSchema.parse({ ...input, id: generateId('conv_'), enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(protocolConverters).values(converter).run()
  return converter
}

export async function updateProtocolConverter(id: string, updates: Partial<Pick<ProtocolConverter, 'clientProtocol' | 'enabled'>>): Promise<ProtocolConverter> {
  const existing = await getProtocolConverter(id)
  if (!existing) throw new Error(`protocol converter not found: ${id}`)
  const converter = ProtocolConverterSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(protocolConverters).set({ clientProtocol: converter.clientProtocol, enabled: converter.enabled, updatedTime: converter.updatedTime }).where(eq(protocolConverters.id, id)).run()
  return converter
}

export async function deleteProtocolConverter(id: string): Promise<void> {
  getDb().delete(protocolConverters).where(eq(protocolConverters.id, id)).run()
}

type CreateRequestLogInput = Omit<RequestLog, 'id' | 'createdTime'> & { id?: string }

export async function createRequestLog(input: CreateRequestLogInput): Promise<RequestLog> {
  const id = input.id ?? generateId('req_')
  const time = now()
  getDb().insert(requestLogs).values({ id, logicalModelId: input.logicalModelId, protocol: input.protocol, status: input.status, metadata: null, createdTime: time }).run()
  const metricValues: Array<typeof requestMetrics.$inferInsert> = []
  if (input.totalDurationMilliseconds != null) metricValues.push({ requestId: id, key: 'durationMilliseconds', value: input.totalDurationMilliseconds, unit: 'milliseconds', updatedTime: time })
  if (input.ttftMilliseconds != null) metricValues.push({ requestId: id, key: 'ttftMilliseconds', value: input.ttftMilliseconds, unit: 'milliseconds', updatedTime: time })
  if (input.promptCacheHit != null) metricValues.push({ requestId: id, key: 'promptCacheHit', value: input.promptCacheHit ? 1 : 0, unit: 'boolean', updatedTime: time })
  if (input.cacheHit != null) metricValues.push({ requestId: id, key: 'cacheHit', value: input.cacheHit ? 1 : 0, unit: 'boolean', updatedTime: time })
  getDb().insert(requestMetrics).values(metricValues).run()
  const usageValues: Array<typeof requestUsages.$inferInsert> = []
  for (const [type, value] of [
    ['inputTokens', input.inputTokens],
    ['outputTokens', input.outputTokens],
    ['totalTokens', input.totalTokens],
    ['cachedInputTokens', input.cachedInputTokens],
    ['cacheCreationInputTokens', input.cacheCreationInputTokens],
  ] as const) {
    if (value != null) usageValues.push({ id: generateId('usage_'), requestId: id, attemptId: null, type, value, unit: 'tokens', createdTime: time })
  }
  if (usageValues.length > 0) getDb().insert(requestUsages).values(usageValues).run()
  if (input.rawUsage != null) getDb().insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type: 'raw', value: 0, unit: serializeRawUsage(input.rawUsage) ?? '', createdTime: time }).run()
  return { id, logicalModelId: input.logicalModelId, protocol: input.protocol, upstreamProtocol: input.upstreamProtocol ?? null, status: input.status, totalDurationMilliseconds: input.totalDurationMilliseconds, totalTokens: input.totalTokens ?? null, inputTokens: input.inputTokens ?? null, outputTokens: input.outputTokens ?? null, cachedInputTokens: input.cachedInputTokens ?? null, cacheCreationInputTokens: input.cacheCreationInputTokens ?? null, promptCacheHit: input.promptCacheHit ?? null, rawUsage: input.rawUsage ?? null, ttftMilliseconds: input.ttftMilliseconds ?? null, cacheHit: input.cacheHit ?? null, createdTime: time }
}

export interface RequestUsageSnapshot {
  requestId: string
  attemptId: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  rawUsage: RawUsage | null
}

export async function replaceRequestUsage(input: RequestUsageSnapshot): Promise<void> {
  const time = now()
  const scope = input.attemptId === null
    ? and(eq(requestUsages.requestId, input.requestId), isNull(requestUsages.attemptId))
    : and(eq(requestUsages.requestId, input.requestId), eq(requestUsages.attemptId, input.attemptId))
  const values: Array<{ type: string; value: number; unit: string }> = []
  for (const [type, value] of [
    ['inputTokens', input.inputTokens],
    ['outputTokens', input.outputTokens],
    ['totalTokens', input.totalTokens],
    ['cachedInputTokens', input.cachedInputTokens],
    ['cacheCreationInputTokens', input.cacheCreationInputTokens],
  ] as const) {
    if (value !== null) values.push({ type, value, unit: 'tokens' })
  }
  if (input.rawUsage !== null) values.push({ type: 'raw', value: 0, unit: serializeRawUsage(input.rawUsage) ?? '' })

  getDb().transaction(transaction => {
    transaction.delete(requestUsages).where(scope).run()
    if (values.length > 0) {
      transaction.insert(requestUsages).values(values.map(value => ({
        id: generateId('usage_'),
        requestId: input.requestId,
        attemptId: input.attemptId,
        ...value,
        createdTime: time,
      }))).run()
    }
  })
}

export async function listRequestUsages(requestId: string): Promise<RequestUsageSnapshot[]> {
  const rows = getDb().select().from(requestUsages).where(eq(requestUsages.requestId, requestId)).all()
  const scopes = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.attemptId ?? 'request'
    scopes.set(key, [...(scopes.get(key) ?? []), row])
  }
  return [...scopes.entries()].map(([key, usages]) => {
    const value = (type: string) => usages.find(usage => usage.type === type)?.value ?? null
    const raw = usages.find(usage => usage.type === 'raw')
    return {
      requestId,
      attemptId: key === 'request' ? null : key,
      inputTokens: value('inputTokens'),
      outputTokens: value('outputTokens'),
      totalTokens: value('totalTokens'),
      cachedInputTokens: value('cachedInputTokens'),
      cacheCreationInputTokens: value('cacheCreationInputTokens'),
      rawUsage: parseRawUsage(raw?.unit),
    }
  })
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
    const requestScope = and(eq(requestUsages.requestId, id), isNull(requestUsages.attemptId))
    const usageUpdates: Array<[keyof RequestLogUpdate, string]> = [
      ['inputTokens', 'inputTokens'],
      ['outputTokens', 'outputTokens'],
      ['totalTokens', 'totalTokens'],
      ['cachedInputTokens', 'cachedInputTokens'],
      ['cacheCreationInputTokens', 'cacheCreationInputTokens'],
    ]
    for (const [field, type] of usageUpdates) {
      const value = update[field]
      if (value === null) transaction.delete(requestUsages).where(and(requestScope, eq(requestUsages.type, type))).run()
      else if (value !== undefined) {
        transaction.delete(requestUsages).where(and(requestScope, eq(requestUsages.type, type))).run()
        transaction.insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type, value: value as number, unit: 'tokens', createdTime: time }).run()
      }
    }
    if (update.rawUsage !== undefined) {
      transaction.delete(requestUsages).where(and(requestScope, eq(requestUsages.type, 'raw'))).run()
      if (update.rawUsage !== null) transaction.insert(requestUsages).values({ id: generateId('usage_'), requestId: id, attemptId: null, type: 'raw', value: 0, unit: serializeRawUsage(update.rawUsage) ?? '', createdTime: time }).run()
    }
  })
}

export interface RequestLogFilter {
  providerId?: string
  logicalModelId?: string
  protocol?: string
  status?: RequestStatus
  createdTimeFrom?: number
  createdTimeTo?: number
}

function requestLogFilterConditions(filter?: RequestLogFilter) {
  if (!filter) return []
  const conditions = []
  if (filter.providerId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${requestAttempts} a WHERE a.requestId = ${requestLogs.id} AND a.providerId = ${filter.providerId})`,
    )
  }
  if (filter.logicalModelId) conditions.push(eq(requestLogs.logicalModelId, filter.logicalModelId))
  if (filter.protocol) conditions.push(eq(requestLogs.protocol, filter.protocol))
  if (filter.status) conditions.push(eq(requestLogs.status, filter.status))
  if (filter.createdTimeFrom !== undefined) conditions.push(gte(requestLogs.createdTime, filter.createdTimeFrom))
  if (filter.createdTimeTo !== undefined) conditions.push(lt(requestLogs.createdTime, filter.createdTimeTo))
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
      .where(lt(requestLogs.createdTime, cutoffTime))
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

// ========== Row mappers ==========

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
  const usages = getDb().select().from(requestUsages).where(and(eq(requestUsages.requestId, row.id), isNull(requestUsages.attemptId))).all()
  const raw = usages.find(usage => usage.type === 'raw')
  const usageValue = (type: string) => usages.find(usage => usage.type === type)?.value ?? null
  const metricValue = (key: string) => metrics.get(key)?.value ?? null
  return {
    id: row.id,
    logicalModelId: row.logicalModelId,
    protocol: row.protocol as RequestLog['protocol'],
    upstreamProtocol: null,
    status: row.status as RequestStatus,
    totalDurationMilliseconds: Number(metricValue('durationMilliseconds') ?? 0),
    totalTokens: usageValue('totalTokens'),
    inputTokens: usageValue('inputTokens'),
    outputTokens: usageValue('outputTokens'),
    cachedInputTokens: usageValue('cachedInputTokens'),
    cacheCreationInputTokens: usageValue('cacheCreationInputTokens'),
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
