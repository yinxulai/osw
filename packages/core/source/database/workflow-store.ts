import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { generateId, now } from '@common/utils'
import { resourceNotFoundError, translateSqliteUniqueViolation } from '../errors'
import { getConfigDb } from './index'
import { workflows } from './config-schema'

export interface WorkflowRecord {
  id: string
  type: string
  version: number
  name: string
  /** 用户给这一版写的说明；留空表示没写（不是「未设置」）。 */
  description: string
  definition: unknown
  createdTime: number
  updatedTime: number
  deletedTime: number | null
}

type WorkflowRow = typeof workflows.$inferSelect

function parseWorkflow(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    name: row.name,
    description: row.description,
    definition: JSON.parse(row.definition) as unknown,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

export async function listWorkflows(includeDeleted = false): Promise<WorkflowRecord[]> {
  const rows = getConfigDb().select().from(workflows).where(includeDeleted ? undefined : isNull(workflows.deletedTime)).orderBy(asc(workflows.type), desc(workflows.version)).all()
  return rows.map(parseWorkflow)
}

/**
 * 按型号与版本号取一行。
 *
 * 优先返回**活跃行**：版本号只在活跃行之间唯一（见 `config-schema.ts` 的
 * `idx_workflows_type_version`），被裁掉的旧版本日后可能把同一个号让给新版本，
 * 那时同一号上会同时存在一活一删两行，取到哪一行不能靠运气。
 */
export async function getWorkflow(type: string, version: number): Promise<WorkflowRecord | undefined> {
  const row = getConfigDb().select().from(workflows)
    .where(and(eq(workflows.type, type), eq(workflows.version, version)))
    .orderBy(asc(sql`${workflows.deletedTime} IS NOT NULL`), desc(workflows.updatedTime))
    .get()
  return row ? parseWorkflow(row) : undefined
}

export async function getLatestWorkflow(type: string): Promise<WorkflowRecord | undefined> {
  const row = getConfigDb().select().from(workflows).where(and(eq(workflows.type, type), isNull(workflows.deletedTime))).orderBy(desc(workflows.version), desc(workflows.updatedTime)).get()
  return row ? parseWorkflow(row) : undefined
}

export async function createWorkflow(input: Omit<WorkflowRecord, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Promise<WorkflowRecord> {
  const time = now()
  const workflow: WorkflowRecord = {
    id: generateId('workflow_'),
    type: input.type,
    version: input.version,
    name: input.name,
    description: input.description,
    definition: input.definition,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
  try {
    getConfigDb().insert(workflows).values({
      id: workflow.id,
      type: workflow.type,
      version: workflow.version,
      name: workflow.name,
      description: workflow.description,
      definition: JSON.stringify(workflow.definition),
      createdTime: workflow.createdTime,
      updatedTime: workflow.updatedTime,
      deletedTime: workflow.deletedTime,
    }).run()
  } catch (error) {
    // 同一毫秒里两次保存会算出同一个版本号，撞上活跃行的唯一索引；翻译成 409，别当 500 报。
    throw translateSqliteUniqueViolation(error) ?? error
  }
  return workflow
}

export async function updateWorkflow(id: string, updates: Partial<Omit<WorkflowRecord, 'id' | 'type' | 'version' | 'createdTime'>>): Promise<WorkflowRecord> {
  const existing = getConfigDb().select().from(workflows).where(eq(workflows.id, id)).get()
  if (!existing) throw resourceNotFoundError('workflow', id)
  const next: WorkflowRecord = {
    ...parseWorkflow(existing),
    ...updates,
    id,
    type: existing.type,
    version: existing.version,
    updatedTime: now(),
  }
  getConfigDb().update(workflows).set({
    name: next.name,
    description: next.description,
    definition: JSON.stringify(next.definition),
    updatedTime: next.updatedTime,
    deletedTime: next.deletedTime,
  }).where(eq(workflows.id, id)).run()
  return next
}

export async function deleteWorkflow(id: string): Promise<void> {
  const time = now()
  getConfigDb().update(workflows).set({ deletedTime: time, updatedTime: time }).where(eq(workflows.id, id)).run()
}
