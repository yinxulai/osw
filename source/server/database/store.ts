import { getDb } from './index'
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

type ProviderRow = Awaited<ReturnType<ReturnType<typeof getDb>['provider']['findUnique']>>
type LogicalModelRow = Awaited<ReturnType<ReturnType<typeof getDb>['logicalModel']['findUnique']>>
type BindingRow = Awaited<ReturnType<ReturnType<typeof getDb>['modelBinding']['findUnique']>>
type HealthRow = Awaited<ReturnType<ReturnType<typeof getDb>['providerHealth']['findUnique']>>
type SettingsRow = Awaited<ReturnType<ReturnType<typeof getDb>['settings']['findUnique']>>
type RequestLogRow = Awaited<ReturnType<ReturnType<typeof getDb>['requestLog']['findUnique']>>
type RequestAttemptRow = Awaited<ReturnType<ReturnType<typeof getDb>['requestAttempt']['findUnique']>>

function mapProvider(row: NonNullable<ProviderRow>): Provider {
  return {
    ...row,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

function mapLogicalModel(row: NonNullable<LogicalModelRow>): LogicalModel {
  return {
    ...row,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

function mapBinding(row: NonNullable<BindingRow>): ModelBinding {
  return {
    ...row,
    protocol: row.protocol as ModelBinding['protocol'],
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

function mapHealth(row: NonNullable<HealthRow>): ProviderHealth {
  return {
    ...row,
    cooldownUntilTime: row.cooldownUntilTime === null ? null : Number(row.cooldownUntilTime),
    lastSuccessTime: row.lastSuccessTime === null ? null : Number(row.lastSuccessTime),
    lastFailureTime: row.lastFailureTime === null ? null : Number(row.lastFailureTime),
    updatedTime: Number(row.updatedTime),
  }
}

function mapSettings(row: NonNullable<SettingsRow>): Settings {
  return { ...row, id: 'singleton', updatedTime: Number(row.updatedTime) }
}

function mapRequestLog(row: NonNullable<RequestLogRow>): RequestLog {
  return {
    ...row,
    protocol: row.protocol as RequestLog['protocol'],
    status: row.status as RequestStatus,
    createdTime: Number(row.createdTime),
  }
}

function mapRequestAttempt(row: NonNullable<RequestAttemptRow>): RequestAttempt {
  return {
    ...row,
    status: row.status as RequestStatus,
    createdTime: Number(row.createdTime),
  }
}

// ========== Provider ==========

export async function listProviders(includeDeleted = false): Promise<Provider[]> {
  const rows = await getDb().provider.findMany({
    where: includeDeleted ? undefined : { deletedTime: null },
    orderBy: { createdTime: 'desc' },
  })
  return rows.map(mapProvider)
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const row = await getDb().provider.findUnique({ where: { id } })
  return row ? mapProvider(row) : undefined
}

export async function createProvider(
  input: Omit<Provider, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>,
): Promise<Provider> {
  const id = generateId('prov_')
  const time = now()
  const row = await getDb().provider.create({
    data: {
      ...input,
      id,
      createdTime: BigInt(time),
      updatedTime: BigInt(time),
      health: { create: { updatedTime: BigInt(time) } },
    },
  })
  return mapProvider(row)
}

export async function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdTime'>>): Promise<Provider> {
  const row = await getDb().provider.update({
    where: { id },
    data: {
      ...updates,
      updatedTime: BigInt(now()),
      deletedTime: updates.deletedTime === undefined ? undefined : toNullableBigInt(updates.deletedTime),
    },
  })
  return mapProvider(row)
}

export async function deleteProvider(id: string): Promise<void> {
  const time = BigInt(now())
  await getDb().$transaction([
    getDb().provider.updateMany({
      where: { id, deletedTime: null },
      data: { deletedTime: time, updatedTime: time },
    }),
    getDb().modelBinding.updateMany({
      where: { providerId: id, deletedTime: null },
      data: { enabled: false, updatedTime: time },
    }),
  ])
}

// ========== Logical Model ==========

export async function listLogicalModels(includeDeleted = false): Promise<LogicalModel[]> {
  const rows = await getDb().logicalModel.findMany({
    where: includeDeleted ? undefined : { deletedTime: null },
    orderBy: { createdTime: 'desc' },
  })
  return rows.map(mapLogicalModel)
}

export async function getLogicalModel(id: string): Promise<LogicalModel | undefined> {
  const row = await getDb().logicalModel.findUnique({ where: { id } })
  return row ? mapLogicalModel(row) : undefined
}

export async function createLogicalModel(input: Omit<LogicalModel, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Promise<LogicalModel> {
  const time = now()
  const row = await getDb().logicalModel.create({
    data: {
      ...input,
      id: generateId('model_'),
      createdTime: BigInt(time),
      updatedTime: BigInt(time),
    },
  })
  return mapLogicalModel(row)
}

export async function updateLogicalModel(id: string, updates: Partial<Omit<LogicalModel, 'id' | 'createdTime'>>): Promise<LogicalModel> {
  const row = await getDb().logicalModel.update({
    where: { id },
    data: {
      ...updates,
      updatedTime: BigInt(now()),
      deletedTime: updates.deletedTime === undefined ? undefined : toNullableBigInt(updates.deletedTime),
    },
  })
  return mapLogicalModel(row)
}

export async function deleteLogicalModel(id: string): Promise<void> {
  const time = BigInt(now())
  await getDb().$transaction([
    getDb().logicalModel.updateMany({
      where: { id, deletedTime: null },
      data: { deletedTime: time, updatedTime: time },
    }),
    getDb().modelBinding.updateMany({
      where: { logicalModelId: id, deletedTime: null },
      data: { deletedTime: time, updatedTime: time },
    }),
  ])
}

// ========== Model Binding ==========

export async function listBindingsByModel(logicalModelId: string, includeDeleted = false): Promise<ModelBinding[]> {
  const rows = await getDb().modelBinding.findMany({
    where: { logicalModelId, ...(includeDeleted ? {} : { deletedTime: null }) },
    orderBy: { priority: 'asc' },
  })
  return rows.map(mapBinding)
}

export async function listBindingsByProvider(providerId: string, includeDeleted = false): Promise<ModelBinding[]> {
  const rows = await getDb().modelBinding.findMany({
    where: { providerId, ...(includeDeleted ? {} : { deletedTime: null }) },
    orderBy: { priority: 'asc' },
  })
  return rows.map(mapBinding)
}

export async function getBinding(id: string): Promise<ModelBinding | undefined> {
  const row = await getDb().modelBinding.findUnique({ where: { id } })
  return row ? mapBinding(row) : undefined
}

export async function createBinding(input: Omit<ModelBinding, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Promise<ModelBinding> {
  const time = now()
  const row = await getDb().modelBinding.create({
    data: {
      ...input,
      id: generateId('bind_'),
      createdTime: BigInt(time),
      updatedTime: BigInt(time),
    },
  })
  return mapBinding(row)
}

export async function updateBinding(id: string, updates: Partial<Omit<ModelBinding, 'id' | 'createdTime'>>): Promise<ModelBinding> {
  const row = await getDb().modelBinding.update({
    where: { id },
    data: {
      ...updates,
      updatedTime: BigInt(now()),
      deletedTime: updates.deletedTime === undefined ? undefined : toNullableBigInt(updates.deletedTime),
    },
  })
  return mapBinding(row)
}

export async function deleteBinding(id: string): Promise<void> {
  const time = BigInt(now())
  await getDb().modelBinding.updateMany({
    where: { id, deletedTime: null },
    data: { deletedTime: time, updatedTime: time },
  })
}

// ========== Provider Health ==========

export async function getProviderHealth(providerId: string): Promise<ProviderHealth | undefined> {
  const row = await getDb().providerHealth.findUnique({ where: { providerId } })
  return row ? mapHealth(row) : undefined
}

export async function listProviderHealth(): Promise<ProviderHealth[]> {
  return (await getDb().providerHealth.findMany()).map(mapHealth)
}

export async function recordHealthSuccess(providerId: string): Promise<void> {
  const time = BigInt(now())
  await getDb().providerHealth.updateMany({
    where: { providerId },
    data: {
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: time,
      updatedTime: time,
    },
  })
}

export async function recordHealthFailure(providerId: string, cooldownUntil: number | null): Promise<void> {
  const time = BigInt(now())
  await getDb().providerHealth.updateMany({
    where: { providerId },
    data: {
      consecutiveFailures: { increment: 1 },
      cooldownUntilTime: toNullableBigInt(cooldownUntil),
      lastFailureTime: time,
      updatedTime: time,
    },
  })
}

export async function resetProviderHealth(providerId: string): Promise<void> {
  await getDb().providerHealth.updateMany({
    where: { providerId },
    data: {
      consecutiveFailures: 0,
      cooldownUntilTime: null,
      lastSuccessTime: null,
      lastFailureTime: null,
      updatedTime: BigInt(now()),
    },
  })
}

// ========== Settings ==========

const SETTINGS_ID = 'singleton'

export async function getSettings(): Promise<Settings> {
  const row = await getDb().settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID, updatedTime: BigInt(now()) },
  })
  return mapSettings(row)
}

export async function updateSettings(updates: Partial<Omit<Settings, 'id' | 'updatedTime'>>): Promise<Settings> {
  await getSettings()
  const row = await getDb().settings.update({
    where: { id: SETTINGS_ID },
    data: { ...updates, updatedTime: BigInt(now()) },
  })
  return mapSettings(row)
}

// ========== Request Log ==========

export async function createRequestLog(input: Omit<RequestLog, 'id' | 'createdTime'>): Promise<RequestLog> {
  const row = await getDb().requestLog.create({
    data: { ...input, id: generateId('req_'), createdTime: BigInt(now()) },
  })
  return mapRequestLog(row)
}

export async function updateRequestLogStatus(id: string, status: RequestStatus, totalDurationMilliseconds: number, totalTokens: number | null = null): Promise<void> {
  await getDb().requestLog.updateMany({
    where: { id },
    data: { status, totalDurationMilliseconds, totalTokens },
  })
}

export async function listRequestLogs(limit = 50): Promise<RequestLog[]> {
  const rows = await getDb().requestLog.findMany({
    orderBy: { createdTime: 'desc' },
    take: limit,
  })
  return rows.map(mapRequestLog)
}

export async function createRequestAttempt(
  input: Omit<RequestAttempt, 'id' | 'createdTime'>,
): Promise<RequestAttempt> {
  const row = await getDb().requestAttempt.create({
    data: { ...input, id: generateId('att_'), createdTime: BigInt(now()) },
  })
  return mapRequestAttempt(row)
}

export async function listAttemptsByRequest(requestId: string): Promise<RequestAttempt[]> {
  const rows = await getDb().requestAttempt.findMany({
    where: { requestId },
    orderBy: { attemptIndex: 'asc' },
  })
  return rows.map(mapRequestAttempt)
}

function toNullableBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(value)
}
