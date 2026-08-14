import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type {
  Provider,
  LogicalModel,
  ModelBinding,
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
  modelBindings,
  providerHealth,
  providers,
  requestAttempts,
  requestLogs,
  settings,
} from './schema'

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
      .update(modelBindings)
      .set({ enabled: false, updatedTime: time })
      .where(and(eq(modelBindings.providerId, id), isNull(modelBindings.deletedTime)))
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
      .update(modelBindings)
      .set({ deletedTime: time, updatedTime: time })
      .where(and(eq(modelBindings.logicalModelId, id), isNull(modelBindings.deletedTime)))
      .run()
  })
}

// ========== Model Binding ==========

export async function listBindingsByModel(logicalModelId: string, includeDeleted = false): Promise<ModelBinding[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db
        .select()
        .from(modelBindings)
        .where(eq(modelBindings.logicalModelId, logicalModelId))
        .orderBy(modelBindings.priority)
        .all()
    : db
        .select()
        .from(modelBindings)
        .where(
          and(
            eq(modelBindings.logicalModelId, logicalModelId),
            isNull(modelBindings.deletedTime),
          ),
        )
        .orderBy(modelBindings.priority)
        .all()
  return rows.map(mapBinding)
}

export async function listBindingsByProvider(providerId: string, includeDeleted = false): Promise<ModelBinding[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db
        .select()
        .from(modelBindings)
        .where(eq(modelBindings.providerId, providerId))
        .orderBy(modelBindings.priority)
        .all()
    : db
        .select()
        .from(modelBindings)
        .where(and(eq(modelBindings.providerId, providerId), isNull(modelBindings.deletedTime)))
        .orderBy(modelBindings.priority)
        .all()
  return rows.map(mapBinding)
}

export async function getBinding(id: string): Promise<ModelBinding | undefined> {
  const row = getDb().select().from(modelBindings).where(eq(modelBindings.id, id)).get()
  return row ? mapBinding(row) : undefined
}

export async function createBinding(
  input: Omit<ModelBinding, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>,
): Promise<ModelBinding> {
  const id = generateId('bind_')
  const time = now()
  getDb()
    .insert(modelBindings)
    .values({
      id,
      logicalModelId: input.logicalModelId,
      providerId: input.providerId,
      protocol: input.protocol,
      upstreamUrl: input.upstreamUrl ?? '',
      upstreamModelId: input.upstreamModelId,
      priority: input.priority,
      enabled: input.enabled ?? true,
      customAuthHeader: input.customAuthHeader ?? null,
      createdTime: time,
      updatedTime: time,
    })
    .run()
  return {
    id,
    logicalModelId: input.logicalModelId,
    providerId: input.providerId,
    protocol: input.protocol,
    upstreamUrl: input.upstreamUrl ?? '',
    upstreamModelId: input.upstreamModelId,
    priority: input.priority,
    enabled: input.enabled ?? true,
    customAuthHeader: input.customAuthHeader ?? null,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
}

export async function updateBinding(id: string, updates: Partial<Omit<ModelBinding, 'id' | 'createdTime'>>): Promise<ModelBinding> {
  const db = getDb()
  const time = now()
  db.update(modelBindings)
    .set({
      ...(updates.logicalModelId !== undefined ? { logicalModelId: updates.logicalModelId } : {}),
      ...(updates.providerId !== undefined ? { providerId: updates.providerId } : {}),
      ...(updates.protocol !== undefined ? { protocol: updates.protocol } : {}),
      ...(updates.upstreamUrl !== undefined ? { upstreamUrl: updates.upstreamUrl } : {}),
      ...(updates.upstreamModelId !== undefined ? { upstreamModelId: updates.upstreamModelId } : {}),
      ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
      ...(updates.customAuthHeader !== undefined
        ? { customAuthHeader: updates.customAuthHeader }
        : {}),
      ...(updates.deletedTime !== undefined ? { deletedTime: updates.deletedTime } : {}),
      updatedTime: time,
    })
    .where(and(eq(modelBindings.id, id), isNull(modelBindings.deletedTime)))
    .run()
  const row = db.select().from(modelBindings).where(eq(modelBindings.id, id)).get()
  return mapBinding(row!)
}

export async function deleteBinding(id: string): Promise<void> {
  const time = now()
  getDb()
    .update(modelBindings)
    .set({ deletedTime: time, updatedTime: time })
    .where(and(eq(modelBindings.id, id), isNull(modelBindings.deletedTime)))
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
      updatedTime: time,
    })
    .where(eq(settings.id, SETTINGS_ID))
    .run()
  const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get()
  return mapSettings(row!)
}

// ========== Request Log ==========

export async function createRequestLog(
  input: Omit<RequestLog, 'id' | 'createdTime'>,
): Promise<RequestLog> {
  const id = generateId('req_')
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
    createdTime: time,
  }
}

export async function updateRequestLogStatus(id: string, status: RequestStatus, totalDurationMilliseconds: number, totalTokens: number | null = null): Promise<void> {
  getDb()
    .update(requestLogs)
    .set({
      status,
      totalDurationMilliseconds,
      totalTokens,
    })
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
      bindingId: input.bindingId,
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
    bindingId: input.bindingId,
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

function mapBinding(row: typeof modelBindings.$inferSelect): ModelBinding {
  return {
    id: row.id,
    logicalModelId: row.logicalModelId,
    providerId: row.providerId,
    protocol: row.protocol as ModelBinding['protocol'],
    upstreamUrl: row.upstreamUrl,
    upstreamModelId: row.upstreamModelId,
    priority: row.priority,
    enabled: row.enabled,
    customAuthHeader: row.customAuthHeader,
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
    createdTime: Number(row.createdTime),
  }
}

function mapRequestAttempt(row: typeof requestAttempts.$inferSelect): RequestAttempt {
  return {
    id: row.id,
    requestId: row.requestId,
    providerId: row.providerId,
    bindingId: row.bindingId,
    upstreamModelId: row.upstreamModelId,
    attemptIndex: row.attemptIndex,
    status: row.status as RequestStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    durationMilliseconds: row.durationMilliseconds,
    createdTime: Number(row.createdTime),
  }
}
