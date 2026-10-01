import { and, desc, eq } from 'drizzle-orm'
import { generateId, now } from '@common/utils'
import { resourceNotFoundError } from '../errors'
import { getConfigDb } from './index'
import { workflows } from './config-schema'

/**
 * `workflows` 表的一行：一份**保存下来的路由图版本**。
 *
 * 只有路由图住在这张表里（`type = 'router'`）。路由规则表已经搬到自己的 `route_rule_sets`
 * 表（见 `route-rule-store.ts`），不再靠 `type` 与图共用一张表——两种定义共用一个行空间，
 * 只会得到「这个 id 是图的还是表的」这种没人该回答的问题。
 *
 * **没有软删除**：一版就是一个可回滚的历史，删掉它等于用户自己存的东西找不回来。
 * 版本列表本来就只展示最近若干版，不需要靠删除来控制。
 */
export interface WorkflowRecord {
  /** **数据记录 id**（`workflow_`）：对外的身份，接口按它来。 */
  id: string
  type: string
  /** 展示用的版本号，取值是「当前最大版本号 + 1」 */
  version: number
  name: string
  /** 用户给这一版写的说明；留空表示没写（不是「未设置」）。 */
  description: string
  definition: unknown
  createdTime: number
  updatedTime: number
}

type WorkflowRow = typeof workflows.$inferSelect

/** 追加一版时的入参；`version` 只给测试与导入用，正常路径不传。 */
export type CreateWorkflowInput = Omit<WorkflowRecord, 'id' | 'version' | 'createdTime' | 'updatedTime'> & { version?: number }

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
  }
}

/** 某个 `type` 的全部版本，新的在前。 */
export async function listWorkflows(type: string): Promise<WorkflowRecord[]> {
  return getConfigDb().select().from(workflows)
    .where(eq(workflows.type, type))
    .orderBy(desc(workflows.version), desc(workflows.updatedTime)).all().map(parseWorkflow)
}

/**
 * 按**记录 id** 取一行。
 *
 * 身份是 `id`，不是版本号：接口按 id 来，云模式里别人分享过来的一版也要靠 id 才能和自己这边的
 * 版本号对上——「第几版」在两个人的库里本来就不可能一致。
 */
export async function getWorkflow(id: string): Promise<WorkflowRecord | undefined> {
  const row = getConfigDb().select().from(workflows).where(eq(workflows.id, id)).get()
  return row ? parseWorkflow(row) : undefined
}

/** 按版本号取一行。版本号由 `createWorkflow` 单调发放，因此同一 (`type`, `version`) 至多一条。 */
export async function getWorkflowByVersion(type: string, version: number): Promise<WorkflowRecord | undefined> {
  const row = getConfigDb().select().from(workflows)
    .where(and(eq(workflows.type, type), eq(workflows.version, version))).get()
  return row ? parseWorkflow(row) : undefined
}

/** 某个 `type` 里版本号最大的那一行；一版都没有时返回 `undefined`。 */
export async function getLatestWorkflow(type: string): Promise<WorkflowRecord | undefined> {
  const row = getConfigDb().select().from(workflows)
    .where(eq(workflows.type, type)).orderBy(desc(workflows.version), desc(workflows.updatedTime)).get()
  return row ? parseWorkflow(row) : undefined
}

/**
 * 追加一版。
 *
 * 版本号在这里发放（「当前最大 + 1」），不交给调用方填：它是展示用的编号，唯一的要求是
 * 单调递增，而这件事只有一处能知道当前最大是多少。没有删除，所以号只会往前走，不会回收。
 *
 * `input.version` 只给测试与导入用（塞一行指定号的历史数据）；正常路径不要传。
 */
export async function createWorkflow(input: CreateWorkflowInput): Promise<WorkflowRecord> {
  const time = now()
  const latest = input.version === undefined ? await getLatestWorkflow(input.type) : undefined
  const workflow: WorkflowRecord = {
    id: generateId('workflow_'),
    type: input.type,
    version: input.version ?? (latest ? latest.version + 1 : 1),
    name: input.name,
    description: input.description,
    definition: input.definition,
    createdTime: time,
    updatedTime: time,
  }
  getConfigDb().insert(workflows).values({
    id: workflow.id,
    type: workflow.type,
    version: workflow.version,
    name: workflow.name,
    description: workflow.description,
    definition: JSON.stringify(workflow.definition),
    createdTime: workflow.createdTime,
    updatedTime: workflow.updatedTime,
    deletedTime: null,
  }).run()
  return workflow
}

export async function updateWorkflow(id: string, updates: Partial<Omit<WorkflowRecord, 'id' | 'type' | 'version' | 'createdTime'>>): Promise<WorkflowRecord> {
  const existing = await getWorkflow(id)
  if (!existing) throw resourceNotFoundError('workflow', id)
  const next: WorkflowRecord = { ...existing, ...updates, id, type: existing.type, version: existing.version, updatedTime: now() }
  getConfigDb().update(workflows).set({
    name: next.name,
    description: next.description,
    definition: JSON.stringify(next.definition),
    updatedTime: next.updatedTime,
  }).where(eq(workflows.id, id)).run()
  return next
}
