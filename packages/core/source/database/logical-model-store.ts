import { and, asc, desc, eq, isNull, max } from 'drizzle-orm'
import type { LogicalModel, SchedulingPolicy } from '@common/schemas'
import { now } from '@common/utils'
import { providerModelDisabledError } from '../errors'
import { getConfigDb } from './index'
import { logicalModels, providerModels, schedulingPolicies } from './config-schema'

export async function listLogicalModels(includeDeleted = false): Promise<LogicalModel[]> {
  const db = getConfigDb()
  const query = db.select().from(logicalModels)
  const rows = includeDeleted
    ? query.orderBy(asc(logicalModels.sortOrder), desc(logicalModels.createdTime)).all()
    : query
        .where(isNull(logicalModels.deletedTime))
        .orderBy(asc(logicalModels.sortOrder), desc(logicalModels.createdTime))
        .all()
  return rows.map(mapLogicalModel)
}

export async function getLogicalModel(id: string): Promise<LogicalModel | undefined> {
  const row = getConfigDb().select().from(logicalModels).where(eq(logicalModels.id, id)).get()
  return row ? mapLogicalModel(row) : undefined
}

type CreateLogicalModelInput = Pick<LogicalModel, 'id'> & Partial<Pick<LogicalModel, 'name' | 'description' | 'enabled'>>

export async function createLogicalModel(input: CreateLogicalModelInput): Promise<LogicalModel> {
  const id = input.id
  const time = now()
  const name = input.name ?? id
  const db = getConfigDb()
  // 新逻辑模型追加到末尾，用户拖动排序后的相对顺序不会被后续创建打乱。
  const maxSortOrder = db.select({ value: max(logicalModels.sortOrder) }).from(logicalModels).get()?.value ?? -1
  db
    .insert(logicalModels)
    .values({
      id,
      name,
      description: input.description ?? '',
      enabled: input.enabled ?? true,
      sortOrder: Number(maxSortOrder) + 1,
      createdTime: time,
      updatedTime: time,
    })
    .run()
  return {
    id,
    name,
    description: input.description ?? '',
    enabled: input.enabled ?? true,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
}

/** 按传入的 id 顺序重写展示顺序；未出现在列表中的逻辑模型保持原有顺序，不受影响。 */
export async function reorderLogicalModels(ids: string[]): Promise<LogicalModel[]> {
  const db = getConfigDb()
  const time = now()
  db.transaction(transaction => {
    ids.forEach((id, index) => {
      transaction.update(logicalModels)
        .set({ sortOrder: index, updatedTime: time })
        .where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime)))
        .run()
    })
  })
  return listLogicalModels()
}

export async function updateLogicalModel(id: string, updates: Partial<Omit<LogicalModel, 'id' | 'createdTime'>>): Promise<LogicalModel> {
  const db = getConfigDb()
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
  getConfigDb()
    .update(logicalModels)
    .set({ deletedTime: time, updatedTime: time })
    .where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime)))
    .run()
}

/**
 * 把被软删除的逻辑模型重新算数。
 *
 * 单独一个函数而不是复用 `updateLogicalModel`：后者的 `where` 带 `isNull(deletedTime)`，
 * 对已删除的行匹配不到任何记录，因此无法用来恢复。云同步拉取时可能带回本机刚刚删掉的 id，
 * 那时需要的是「复活这一行」而不是「新建一行同名记录」（后者会因为主键冲突直接失败）。
 */
export async function restoreLogicalModel(id: string): Promise<void> {
  const time = now()
  getConfigDb()
    .update(logicalModels)
    .set({ deletedTime: null, updatedTime: time })
    .where(eq(logicalModels.id, id))
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
  return { ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime), deletedTime: row.deletedTime === null ? null : Number(row.deletedTime) }
}

export async function listSchedulingPolicies(logicalModelId?: string): Promise<SchedulingPolicy[]> {
  const condition = and(isNull(schedulingPolicies.deletedTime), logicalModelId ? eq(schedulingPolicies.logicalModelId, logicalModelId) : undefined)
  return getConfigDb().select().from(schedulingPolicies)
    .where(condition)
    .orderBy(asc(schedulingPolicies.priority), desc(schedulingPolicies.weight), asc(schedulingPolicies.createdTime), asc(schedulingPolicies.providerModelId))
    .all()
    .map(mapSchedulingPolicy)
}

export type UpsertSchedulingPolicyInput = Pick<SchedulingPolicy, 'logicalModelId' | 'providerModelId'> & Partial<Pick<SchedulingPolicy, 'strategy' | 'priority' | 'weight' | 'enabled'>>

export async function upsertSchedulingPolicy(input: UpsertSchedulingPolicyInput): Promise<SchedulingPolicy> {
  if (input.strategy !== undefined && input.strategy !== 'priority') throw new Error('unsupported scheduling policy strategy')
  if (input.weight !== undefined && (!Number.isInteger(input.weight) || input.weight < 1)) throw new Error('scheduling policy weight must be positive')
  // 显式要求打开绑定时，先看模型本体还在不在：模型被全局停用后，打开的绑定不会被调度，
  // 只会让逻辑模型页看起来「可用」。新建行时需要的是同一个判断，所以调用方必须把模型
  // 本体的开关透传进来（`enabled`），而不是依赖这里的默认值 true。
  if (input.enabled === true) {
    const model = getConfigDb().select({ modelName: providerModels.modelName, enabled: providerModels.enabled })
      .from(providerModels).where(eq(providerModels.id, input.providerModelId)).get()
    if (model && !model.enabled) throw providerModelDisabledError(model.modelName)
  }
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
    deletedTime: null,
  }
  // 缺省值只用于新插入。冲突更新只写调用方给的字段：逻辑模型页关开关只传
  // `enabled`，拖排序只传 `priority`；把没传的列填成默认值会把优先级打成 0，
  // 或把已经关掉的绑定重新打开。
  getConfigDb().insert(schedulingPolicies).values(values).onConflictDoUpdate({
    target: [schedulingPolicies.logicalModelId, schedulingPolicies.providerModelId],
    // 主键不含 `deletedTime`，所以「重新把模型加回逻辑模型」就是让同一行复活：
    // 命中被软删除的历史行时把 `deletedTime` 清掉，而不是再插一条。
    set: {
      updatedTime: time,
      deletedTime: null,
      ...(input.strategy !== undefined ? { strategy: values.strategy } : {}),
      ...(input.priority !== undefined ? { priority: values.priority } : {}),
      ...(input.weight !== undefined ? { weight: values.weight } : {}),
      ...(input.enabled !== undefined ? { enabled: values.enabled } : {}),
    },
  }).run()
  return mapSchedulingPolicy(getConfigDb().select().from(schedulingPolicies).where(and(eq(schedulingPolicies.logicalModelId, input.logicalModelId), eq(schedulingPolicies.providerModelId, input.providerModelId))).get()!)
}

export async function deleteSchedulingPolicy(logicalModelId: string, providerModelId: string): Promise<void> {
  const time = now()
  getConfigDb().update(schedulingPolicies).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(eq(schedulingPolicies.logicalModelId, logicalModelId), eq(schedulingPolicies.providerModelId, providerModelId), isNull(schedulingPolicies.deletedTime))).run()
}
