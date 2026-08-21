import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { LogicalModel, SchedulingPolicy } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import { logicalModels, schedulingPolicies } from './schema'

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
  getDb()
    .update(logicalModels)
    .set({ deletedTime: time, updatedTime: time })
    .where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime)))
    .run()
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

function mapSchedulingPolicy(row: typeof schedulingPolicies.$inferSelect): SchedulingPolicy {
  return { ...row }
}

export async function listSchedulingPolicies(logicalModelId?: string): Promise<SchedulingPolicy[]> {
  const condition = logicalModelId ? eq(schedulingPolicies.logicalModelId, logicalModelId) : undefined
  return getDb().select().from(schedulingPolicies)
    .where(condition)
    .orderBy(asc(schedulingPolicies.priority), desc(schedulingPolicies.weight), asc(schedulingPolicies.createdTime), asc(schedulingPolicies.providerModelId))
    .all()
    .map(mapSchedulingPolicy)
}

export type UpsertSchedulingPolicyInput = Pick<SchedulingPolicy, 'logicalModelId' | 'providerModelId'> & Partial<Pick<SchedulingPolicy, 'strategy' | 'priority' | 'weight' | 'enabled'>>

export async function upsertSchedulingPolicy(input: UpsertSchedulingPolicyInput): Promise<SchedulingPolicy> {
  if (input.strategy !== undefined && input.strategy !== 'priority') throw new Error('unsupported scheduling policy strategy')
  if (input.weight !== undefined && (!Number.isInteger(input.weight) || input.weight < 1)) throw new Error('scheduling policy weight must be positive')
  const time = now()
  const values = {
    logicalModelId: input.logicalModelId,
    providerModelId: input.providerModelId,
    strategy: input.strategy ?? 'priority',
    priority: input.priority ?? 0,
    weight: input.weight ?? 100,
    enabled: input.enabled ?? true,
    createdTime: time,
    updatedTime: time,
  }
  getDb().insert(schedulingPolicies).values(values).onConflictDoUpdate({
    target: [schedulingPolicies.logicalModelId, schedulingPolicies.providerModelId],
    set: { strategy: values.strategy, priority: values.priority, weight: values.weight, enabled: values.enabled, updatedTime: time },
  }).run()
  return mapSchedulingPolicy(getDb().select().from(schedulingPolicies).where(and(eq(schedulingPolicies.logicalModelId, input.logicalModelId), eq(schedulingPolicies.providerModelId, input.providerModelId))).get()!)
}

export async function deleteSchedulingPolicy(logicalModelId: string, providerModelId: string): Promise<void> {
  getDb().delete(schedulingPolicies).where(and(eq(schedulingPolicies.logicalModelId, logicalModelId), eq(schedulingPolicies.providerModelId, providerModelId))).run()
}
