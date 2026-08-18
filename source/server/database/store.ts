import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  Provider,
  LogicalModel,
  UpstreamModel,
  ProtocolEndpoint,
  ProviderHealth,
  Settings,
  RequestLog,
  RequestAttempt,
  RequestStatus,
} from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import {
  logicalModels,
  upstreamModels,
  providerHealth,
  providers,
  requestAttempts,
  requestLogs,
  settings,
} from './schema'

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

export async function createProvider(
  input: Omit<Provider, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>,
): Promise<Provider> {
  const id = generateId('prov_')
  const time = now()
  const db = getDb()
  db.insert(providers)
    .values({
      id,
      name: input.name,
      apiKeyReference: input.apiKeyReference,
      timeoutMilliseconds: input.timeoutMilliseconds ?? 30000,
      enabled: input.enabled ?? true,
      upstreamUrls: input.upstreamUrls ?? '{}',
      createdTime: time,
      updatedTime: time,
    })
    .run()
  db.insert(providerHealth)
    .values({
      providerId: id,
      consecutiveFailures: 0,
      updatedTime: time,
    })
    .run()
  return {
    id,
    name: input.name,
    apiKeyReference: input.apiKeyReference,
    timeoutMilliseconds: input.timeoutMilliseconds ?? 30000,
    enabled: input.enabled ?? true,
    upstreamUrls: input.upstreamUrls ?? '{}',
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
}

export async function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdTime'>>): Promise<Provider> {
  const db = getDb()
  const time = now()
  db.update(providers)
    .set({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.apiKeyReference !== undefined ? { apiKeyReference: updates.apiKeyReference } : {}),
      ...(updates.timeoutMilliseconds !== undefined
        ? { timeoutMilliseconds: updates.timeoutMilliseconds }
        : {}),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
      ...(updates.upstreamUrls !== undefined ? { upstreamUrls: updates.upstreamUrls } : {}),
      ...(updates.deletedTime !== undefined ? { deletedTime: updates.deletedTime } : {}),
      updatedTime: time,
    })
    .where(and(eq(providers.id, id), isNull(providers.deletedTime)))
    .run()
  const row = db.select().from(providers).where(eq(providers.id, id)).get()
  return mapProvider(row!)
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
      .update(upstreamModels)
      .set({ enabled: false, updatedTime: time })
      .where(and(eq(upstreamModels.providerId, id), isNull(upstreamModels.deletedTime)))
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

export async function createLogicalModel(
  input: Omit<LogicalModel, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>,
): Promise<LogicalModel> {
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
  db.transaction(transaction => {
    transaction
      .update(logicalModels)
      .set({ deletedTime: time, updatedTime: time })
      .where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime)))
      .run()
    transaction
      .update(upstreamModels)
      .set({ deletedTime: time, updatedTime: time })
      .where(and(eq(upstreamModels.logicalModelId, id), isNull(upstreamModels.deletedTime)))
      .run()
  })
}

// ========== Upstream Model ==========

export async function listUpstreamModelsByLogicalModel(
  logicalModelId: string,
  includeDeleted = false,
): Promise<UpstreamModel[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db
        .select()
        .from(upstreamModels)
        .where(eq(upstreamModels.logicalModelId, logicalModelId))
        .orderBy(upstreamModels.priority)
        .all()
    : db
        .select()
        .from(upstreamModels)
        .where(
          and(
            eq(upstreamModels.logicalModelId, logicalModelId),
            isNull(upstreamModels.deletedTime),
          ),
        )
        .orderBy(upstreamModels.priority)
        .all()
  return rows.map(mapUpstreamModel)
}

export async function listUpstreamModelsByProvider(
  providerId: string,
  includeDeleted = false,
): Promise<UpstreamModel[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db
        .select()
        .from(upstreamModels)
        .where(eq(upstreamModels.providerId, providerId))
        .orderBy(upstreamModels.priority)
        .all()
    : db
        .select()
        .from(upstreamModels)
        .where(and(eq(upstreamModels.providerId, providerId), isNull(upstreamModels.deletedTime)))
        .orderBy(upstreamModels.priority)
        .all()
  return rows.map(mapUpstreamModel)
}

export async function listUpstreamModels(includeDeleted = false): Promise<UpstreamModel[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db.select().from(upstreamModels).orderBy(upstreamModels.priority).all()
    : db.select().from(upstreamModels).where(isNull(upstreamModels.deletedTime)).orderBy(upstreamModels.priority).all()
  return rows.map(mapUpstreamModel)
}

export async function getUpstreamModel(id: string): Promise<UpstreamModel | undefined> {
  const row = getDb().select().from(upstreamModels).where(eq(upstreamModels.id, id)).get()
  return row ? mapUpstreamModel(row) : undefined
}

export async function createUpstreamModel(
  input: Omit<UpstreamModel, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>,
): Promise<UpstreamModel> {
  const id = generateId('model_')
  const time = now()
  getDb()
    .insert(upstreamModels)
    .values({
      id,
      logicalModelId: input.logicalModelId,
      providerId: input.providerId,
      upstreamModelId: input.upstreamModelId,
      endpoints: JSON.stringify(input.endpoints ?? []),
      priority: input.priority,
      enabled: input.enabled ?? true,
      createdTime: time,
      updatedTime: time,
    })
    .run()
  return {
    id,
    logicalModelId: input.logicalModelId,
    providerId: input.providerId,
    upstreamModelId: input.upstreamModelId,
    endpoints: input.endpoints ?? [],
    priority: input.priority,
    enabled: input.enabled ?? true,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
}

export async function updateUpstreamModel(
  id: string,
  updates: Partial<Omit<UpstreamModel, 'id' | 'createdTime'>>,
): Promise<UpstreamModel> {
  const db = getDb()
  const time = now()
  db.update(upstreamModels)
    .set({
      ...(updates.logicalModelId !== undefined ? { logicalModelId: updates.logicalModelId } : {}),
      ...(updates.providerId !== undefined ? { providerId: updates.providerId } : {}),
      ...(updates.upstreamModelId !== undefined
        ? { upstreamModelId: updates.upstreamModelId }
        : {}),
      ...(updates.endpoints !== undefined
        ? { endpoints: JSON.stringify(updates.endpoints) }
        : {}),
      ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
      ...(updates.deletedTime !== undefined ? { deletedTime: updates.deletedTime } : {}),
      updatedTime: time,
    })
    .where(and(eq(upstreamModels.id, id), isNull(upstreamModels.deletedTime)))
    .run()
  const row = db.select().from(upstreamModels).where(eq(upstreamModels.id, id)).get()
  return mapUpstreamModel(row!)
}

export async function deleteUpstreamModel(id: string): Promise<void> {
  const time = now()
  getDb()
    .update(upstreamModels)
    .set({ deletedTime: time, updatedTime: time })
    .where(and(eq(upstreamModels.id, id), isNull(upstreamModels.deletedTime)))
    .run()
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

export async function recordHealthFailure(providerId: string, cooldownUntil: number | null): Promise<void> {
  const time = now()
  getDb()
    .update(providerHealth)
    .set({
      consecutiveFailures: sql`${providerHealth.consecutiveFailures} + 1`,
      cooldownUntilTime: cooldownUntil,
      lastFailureTime: time,
      updatedTime: time,
    })
    .where(eq(providerHealth.providerId, providerId))
    .run()
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

// ========== Settings ==========

const SETTINGS_ID = 'singleton'

export async function getSettings(): Promise<Settings> {
  const db = getDb()
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get()
  if (existing) return mapSettings(existing)
  const time = now()
  db.insert(settings)
    .values({
      id: SETTINGS_ID,
      updatedTime: time,
    })
    .run()
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get()
  return mapSettings(row!)
}

export async function updateSettings(
  updates: Partial<Omit<Settings, 'id' | 'updatedTime'>>,
): Promise<Settings> {
  await getSettings()
  const time = now()
  const db = getDb()
  db.update(settings)
    .set({
      ...(updates.listenHost !== undefined ? { listenHost: updates.listenHost } : {}),
      ...(updates.listenPort !== undefined ? { listenPort: updates.listenPort } : {}),
      ...(updates.accessTokenReference !== undefined
        ? { accessTokenReference: updates.accessTokenReference }
        : {}),
      ...(updates.logRetentionCount !== undefined
        ? { logRetentionCount: updates.logRetentionCount }
        : {}),
      ...(updates.cooldownBaseSeconds !== undefined
        ? { cooldownBaseSeconds: updates.cooldownBaseSeconds }
        : {}),
      ...(updates.cooldownMaxSeconds !== undefined
        ? { cooldownMaxSeconds: updates.cooldownMaxSeconds }
        : {}),
      ...(updates.consecutiveFailureThreshold !== undefined
        ? { consecutiveFailureThreshold: updates.consecutiveFailureThreshold }
        : {}),
      ...(updates.idleTimeoutMilliseconds !== undefined
        ? { idleTimeoutMilliseconds: updates.idleTimeoutMilliseconds }
        : {}),
      ...(updates.autoLaunch !== undefined ? { autoLaunch: updates.autoLaunch } : {}),
      updatedTime: time,
    })
    .where(eq(settings.id, SETTINGS_ID))
    .run()
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get()
  const result = mapSettings(row!)
  notifySettingsChanged(result)
  return result
}

// ========== Request Log ==========

export async function createRequestLog(
  input: Omit<RequestLog, 'id' | 'createdTime'> & { id?: string },
): Promise<RequestLog> {
  const id = input.id ?? generateId('req_')
  const time = now()
  getDb()
    .insert(requestLogs)
    .values({
      id,
      logicalModelId: input.logicalModelId,
      protocol: input.protocol,
      status: input.status,
      totalDurationMilliseconds: input.totalDurationMilliseconds,
      totalTokens: input.totalTokens ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      ttftMilliseconds: input.ttftMilliseconds ?? null,
      cacheHit: input.cacheHit ?? null,
      createdTime: time,
    })
    .run()
  return {
    id,
    logicalModelId: input.logicalModelId,
    protocol: input.protocol,
    status: input.status,
    totalDurationMilliseconds: input.totalDurationMilliseconds,
    totalTokens: input.totalTokens ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    ttftMilliseconds: input.ttftMilliseconds ?? null,
    cacheHit: input.cacheHit ?? null,
    createdTime: time,
  }
}

export interface RequestLogUpdate {
  status?: RequestStatus
  totalDurationMilliseconds?: number
  totalTokens?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  ttftMilliseconds?: number | null
  cacheHit?: boolean | null
}

export async function updateRequestLogStatus(id: string, update: RequestLogUpdate): Promise<void> {
  getDb()
    .update(requestLogs)
    .set(update)
    .where(eq(requestLogs.id, id))
    .run()
}

export async function listRequestLogs(limit = 50): Promise<RequestLog[]> {
  const rows = getDb()
    .select()
    .from(requestLogs)
    .orderBy(desc(requestLogs.createdTime))
    .limit(limit)
    .all()
  return rows.map(mapRequestLog)
}

export async function createRequestAttempt(
  input: Omit<RequestAttempt, 'id' | 'createdTime'>,
): Promise<RequestAttempt> {
  const id = generateId('att_')
  const time = now()
  getDb()
    .insert(requestAttempts)
    .values({
      id,
      requestId: input.requestId,
      providerId: input.providerId,
      upstreamModelId: input.upstreamModelId,
      attemptIndex: input.attemptIndex,
      status: input.status,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      durationMilliseconds: input.durationMilliseconds,
      createdTime: time,
    })
    .run()
  return {
    id,
    requestId: input.requestId,
    providerId: input.providerId,
    upstreamModelId: input.upstreamModelId,
    attemptIndex: input.attemptIndex,
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    durationMilliseconds: input.durationMilliseconds,
    createdTime: time,
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
      avgLatency: sql<number>`avg(${requestLogs.totalDurationMilliseconds})`.as('avgLatency'),
      tokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`.as('tokens'),
    })
    .from(requestLogs)
    .where(sql`${requestLogs.createdTime} >= ${sinceMs}`)
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
    totalTokens: result?.tokens ?? 0,
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
    const key = d.toISOString().slice(0, 10)
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
  // 用 request_attempts 的 attemptIndex=0 作为"归属 provider"统计（即首次尝试的 provider）
  // 更准确的方式：按 request_logs 关联，但 request_logs 没有 providerId
  // 用 attemptIndex=0 代表该请求最初分配给哪个 provider
  const rows = db
    .select({
      providerId: requestAttempts.providerId,
      providerName: providers.name,
      requests: sql<number>`count(distinct ${requestAttempts.requestId})`.as('requests'),
      success: sql<number>`count(distinct case when ${requestAttempts.status} = 'success' then ${requestAttempts.requestId} end)`.as('success'),
      failed: sql<number>`count(distinct case when ${requestAttempts.status} = 'failed' and ${requestAttempts.attemptIndex} = 0 then ${requestAttempts.requestId} end)`.as('failed'),
      avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
    })
    .from(requestAttempts)
    .innerJoin(providers, eq(requestAttempts.providerId, providers.id))
    .where(sql`${requestAttempts.createdTime} >= ${sinceMs}`)
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
  const rows = db
    .select({
      upstreamModelId: requestAttempts.upstreamModelId,
      providerId: requestAttempts.providerId,
      providerName: providers.name,
      requests: sql<number>`count(distinct ${requestAttempts.requestId})`.as('requests'),
      success: sql<number>`count(distinct case when ${requestAttempts.status} = 'success' then ${requestAttempts.requestId} end)`.as('success'),
      avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
    })
    .from(requestAttempts)
    .innerJoin(providers, eq(requestAttempts.providerId, providers.id))
    .where(sql`${requestAttempts.createdTime} >= ${sinceMs}`)
    .groupBy(requestAttempts.upstreamModelId, requestAttempts.providerId)
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
      .where(sql`${requestLogs.createdTime} >= ${sinceMs} and ${requestLogs.totalDurationMilliseconds} >= ${b.min} and ${requestLogs.totalDurationMilliseconds} < ${b.max}`)
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
  // 按 errorCode 分类统计失败 attempt
  const rows = db
    .select({
      errorCode: requestAttempts.errorCode,
      count: sql<number>`count(distinct ${requestAttempts.requestId})`.as('count'),
    })
    .from(requestAttempts)
    .where(sql`${requestAttempts.createdTime} >= ${sinceMs} and ${requestAttempts.status} = 'failed'`)
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
  return {
    id: row.id,
    name: row.name,
    apiKeyReference: row.apiKeyReference,
    timeoutMilliseconds: row.timeoutMilliseconds,
    enabled: row.enabled,
    upstreamUrls: row.upstreamUrls,
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

function mapUpstreamModel(row: typeof upstreamModels.$inferSelect): UpstreamModel {
  return {
    id: row.id,
    logicalModelId: row.logicalModelId,
    providerId: row.providerId,
    upstreamModelId: row.upstreamModelId,
    endpoints: parseEndpoints(row.endpoints),
    priority: row.priority,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

function parseEndpoints(raw: string): ProtocolEndpoint[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ProtocolEndpoint[]) : []
  } catch {
    return []
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

function mapSettings(row: typeof settings.$inferSelect): Settings {
  return {
    id: 'singleton',
    listenHost: row.listenHost,
    listenPort: row.listenPort,
    accessTokenReference: row.accessTokenReference,
    logRetentionCount: row.logRetentionCount,
    cooldownBaseSeconds: row.cooldownBaseSeconds,
    cooldownMaxSeconds: row.cooldownMaxSeconds,
    consecutiveFailureThreshold: row.consecutiveFailureThreshold,
    idleTimeoutMilliseconds: row.idleTimeoutMilliseconds,
    autoLaunch: Boolean(row.autoLaunch),
    updatedTime: Number(row.updatedTime),
  }
}

function mapRequestLog(row: typeof requestLogs.$inferSelect): RequestLog {
  return {
    id: row.id,
    logicalModelId: row.logicalModelId,
    protocol: row.protocol as RequestLog['protocol'],
    status: row.status as RequestStatus,
    totalDurationMilliseconds: row.totalDurationMilliseconds,
    totalTokens: row.totalTokens,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    ttftMilliseconds: row.ttftMilliseconds ?? null,
    cacheHit: row.cacheHit ?? null,
    createdTime: Number(row.createdTime),
  }
}

function mapRequestAttempt(row: typeof requestAttempts.$inferSelect): RequestAttempt {
  return {
    id: row.id,
    requestId: row.requestId,
    providerId: row.providerId,
    upstreamModelId: row.upstreamModelId,
    attemptIndex: row.attemptIndex,
    status: row.status as RequestStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    durationMilliseconds: row.durationMilliseconds,
    createdTime: Number(row.createdTime),
  }
}
