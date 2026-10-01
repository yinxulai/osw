import { and, asc, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_ID } from '@common/schemas'
import type { LogicalModel, SchedulingPolicy } from '@common/schemas'
import { renameLogicalModelIdInGraph, renameLogicalModelIdInRuleSet } from '@common/router/rename-logical-model-id'
import { RouteRuleSetSchema } from '@common/router/route-rules'
import { WorkflowGraphSchema } from '@common/router/schemas'
import { generateId, now } from '@common/utils'
import { duplicateLogicalModelError, logicalModelNotFoundError, protectedLogicalModelError, providerModelDisabledError } from '../errors'
import { cachedConfigRead } from './config-read-cache'
import { getConfigDb } from './index'
import { logicalModels, providerModels, routeRuleSets, schedulingPolicies, workflows } from './config-schema'

/**
 * 逻辑模型的两把钥匙，别混：
 *
 *   - `id`：**数据记录 id**，本机生成（`lm_*`）、永不变。调度绑定的外键、
 *     界面上的拖动排序与所有管理接口入参用的是它。
 *   - `modelId`：**模型 id**，用户起的名、请求按它匹配、路由定义按它引用。它可以被改，
 *     因此绝不能当外键的锚点。
 *
 * 这个文件里凡是「按 id 找」的函数收的都是记录 id；只有 `getLogicalModelByModelId`
 * 与运行时查表（`getAvailableModels` 等）才按 modelId 找。
 *
 * `listLogicalModels` 与 `getLogicalModelByModelId` 走常驻读缓存（见 `./config-read-cache.ts`）：
 * 代理每处理一个请求都要用它把模型名翻成落点，而这份名单只在用户改模型时才变。
 */
export async function listLogicalModels(includeDeleted = false): Promise<LogicalModel[]> {
  return cachedConfigRead(`logical-models:${includeDeleted}`, () => readLogicalModels(includeDeleted))
}

async function readLogicalModels(includeDeleted: boolean): Promise<LogicalModel[]> {
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

/** 按**数据记录 id** 取一个逻辑模型（含已软删除的行）。 */
export async function getLogicalModel(id: string): Promise<LogicalModel | undefined> {
  const row = getConfigDb().select().from(logicalModels).where(eq(logicalModels.id, id)).get()
  return row ? mapLogicalModel(row) : undefined
}

/**
 * 按**模型 id** 取一个活跃的逻辑模型。
 *
 * 这是运行时（代理）唯一的入口：请求里带的是模型名，落点就是它。
 * 「已删除的模型能接到流量」在查询层就不成立：软删除的行 `deletedTime` 非空，一律落在
 * 这里的 `isNull(deletedTime)` 之外。
 *
 * 模型名可能同时被多条已删除的行占着（软删除不改写它们），但活跃行之间唯一 —— 这个不变量
 * 由 `assertLogicalModelIdAvailable` 把守，因此这里查到的永远是那一行。
 */
export async function getLogicalModelByModelId(modelId: string): Promise<LogicalModel | undefined> {
  return cachedConfigRead(`logical-model-by-model-id:${modelId}`, () => readLogicalModelByModelId(modelId))
}

async function readLogicalModelByModelId(modelId: string): Promise<LogicalModel | undefined> {
  const row = getConfigDb().select().from(logicalModels)
    .where(and(eq(logicalModels.modelId, modelId), isNull(logicalModels.deletedTime)))
    .get()
  return row ? mapLogicalModel(row) : undefined
}

/**
 * 把一批**模型 id** 翻成**数据记录 id**（只认活跃行）。
 *
 * 运行时拿到的是请求里的模型名，而调度绑定挂的是记录 id，中间必须有这一次翻译。
 * 放在这里、而不是让每个调用方自己查一次：一次 `IN` 查完整批，且「模型 id 在活跃行里唯一」
 * 这件事只在这一处解释。
 *
 * 查不到的模型 id **不会**出现在结果里。调用方要据此当作「没有这个落点」，而不是拿着模型 id
 * 去查绑定表得到一份空绑定：结果看起来一样，但一个是事实，一个只是巧合。
 *
 * 活跃行之间模型名唯一（见 `assertLogicalModelIdAvailable`），所以一个模型名最多映射到一个
 * 记录 id；已删除的行不参与，删掉的名字在这里查不到。
 */
export async function mapLogicalModelIdsToRecordIds(modelIds: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (modelIds.length === 0) return result
  const rows = getConfigDb()
    .select({ id: logicalModels.id, modelId: logicalModels.modelId })
    .from(logicalModels)
    .where(and(inArray(logicalModels.modelId, [...modelIds]), isNull(logicalModels.deletedTime)))
    .all()
  for (const row of rows) result.set(row.modelId, row.id)
  return result
}

type CreateLogicalModelInput = Pick<LogicalModel, 'modelId'> & Partial<Pick<LogicalModel, 'description' | 'enabled'>>

/**
 * 内建默认逻辑模型的**数据记录 id**。
 *
 * 凡是往外键列（`scheduling_policies.logicalModelId`）上写值的地方都需要它，但只有模型管理页
 * 之外的那些调用方（导入供应商包、批量绑定）手里没有界面传上来的记录 id，只有模型名。
 * 常量 `BUILT_IN_DEFAULT_LOGICAL_MODEL_ID` 是**模型名**，直接当外键写进去会撞 FK —— 这里把
 * 「模型名 → 记录 id」这一步收成一处，免得每个调用方各写一遍、各写错一遍。
 */
export async function getDefaultLogicalModelRecordId(): Promise<string> {
  const model = await getLogicalModelByModelId(BUILT_IN_DEFAULT_LOGICAL_MODEL_ID)
  if (!model) throw new Error(`built-in default logical model is missing: ${BUILT_IN_DEFAULT_LOGICAL_MODEL_ID}`)
  return model.id
}

/**
 * 确认一个**模型 id** 当前没有被活跃的逻辑模型占用，否则抛 409。
 *
 * 收成一处，是因为三个入口问的是同一个问题（新建、改名、从快照导入），而答案必须一致：
 * 重复检查查的是 `modelId` 而不是主键 —— 用户能用界面表达的只有模型名。
 *
 * 判据只有一条：**活跃行之间不许重复**。已软删除的行不参与判断，因此「删掉一个模型、
 * 再建一个同名的」是一次普通的成功，不需要给删除动作补任何改名把戏。
 *
 * `excludeRecordId` 是本行自己的数据记录 id，改名场景要把它排除在外（它当下的 `modelId`
 * 正是我们要改掉的那个，不排除就会自己跟自己撞）。
 */
export async function assertLogicalModelIdAvailable(modelId: string, excludeRecordId?: string): Promise<void> {
  const taken = getConfigDb()
    .select({ id: logicalModels.id })
    .from(logicalModels)
    .where(and(eq(logicalModels.modelId, modelId), isNull(logicalModels.deletedTime)))
    .all()
    .some(row => row.id !== excludeRecordId)
  if (taken) throw duplicateLogicalModelError(modelId)
}

/**
 * 新建一个逻辑模型。
 *
 * 记录 id 在这里生成，**调用方给不了**：它是本机的内部主键，不是用户能用界面表达的东西。
 * 用户给的只有 `modelId`（模型名），所以重复检查查的是 `modelId` 而不是主键 ——
 * 用户看到的是「模型 id 已被占用」，而不是一句「内部错误」。
 */
export async function createLogicalModel(input: CreateLogicalModelInput): Promise<LogicalModel> {
  const modelId = input.modelId
  const db = getConfigDb()
  await assertLogicalModelIdAvailable(modelId)
  const time = now()
  const id = generateId('lm_')
  const description = input.description ?? ''
  const enabled = input.enabled ?? true
  // 新逻辑模型追加到末尾，用户拖动排序后的相对顺序不会被后续创建打乱。
  const maxSortOrder = db.select({ value: max(logicalModels.sortOrder) }).from(logicalModels).get()?.value ?? -1
  db
    .insert(logicalModels)
    .values({
      id,
      modelId,
      description,
      enabled,
      sortOrder: Number(maxSortOrder) + 1,
      createdTime: time,
      updatedTime: time,
    })
    .run()
  return { id, modelId, description, enabled, createdTime: time, updatedTime: time, deletedTime: null }
}

/** 按传入的**数据记录 id** 顺序重写展示顺序；未出现在列表中的逻辑模型保持原有顺序，不受影响。 */
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

/**
 * 改说明、开关，以及**模型 id**。第一把钥匙（数据记录 id）不进这里：它永不变。
 *
 * 改 `modelId` 不只是一列 UPDATE —— 它是「改名」，必须一次性搬走所有引用它的地方，
 * 否则会留下指向空洞的落点：
 *
 *   1. `logical_models.modelId` 本身；
 *   2. 路由定义里的结构化落点与固定值条件（见 `@common/router/rename-logical-model-id`）。
 *      这些是**落点**，不改就会静默退化成兜底；用 `logicalModels[*].modelId` 这类字段比较写的
 *      条件不需要动 —— 它是现算的投影，本来就跟得上改名。
 *
 * 调度绑定**不在名单里**：它外键指着数据记录 id，改名不动那把钥匙，因此一行都不用搬，
 * 也不需要 `ON UPDATE CASCADE` 这类「改一处搬一片」的补救。
 *
 * 没有改动的定义行不写库（纯函数未改动时返回同一个对象），避免一次改名整表 touched。
 * 脚本节点里写死的模型 id 不在改写范围（那是任意代码），历史请求记录也不改（那是观测数据）。
 */
type UpdateLogicalModelInput = Partial<Pick<LogicalModel, 'modelId' | 'description' | 'enabled'>>

export async function updateLogicalModel(id: string, updates: UpdateLogicalModelInput): Promise<LogicalModel> {
  const db = getConfigDb()
  const time = now()
  const existing = db.select().from(logicalModels).where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime))).get()
  if (!existing) throw logicalModelNotFoundError(id)

  const nextModelId = updates.modelId
  const renaming = nextModelId !== undefined && nextModelId !== existing.modelId
  if (renaming) {
    // 内建默认逻辑模型的模型 id 是所有兜底落点的归宿，改名等于把兜底搬走。
    if (existing.modelId === BUILT_IN_DEFAULT_LOGICAL_MODEL_ID) throw protectedLogicalModelError(existing.modelId)
    await assertLogicalModelIdAvailable(nextModelId, id)
  }

  db.transaction(transaction => {
    transaction.update(logicalModels)
      .set({
        ...(renaming ? { modelId: nextModelId } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
        updatedTime: time,
      })
      .where(eq(logicalModels.id, id))
      .run()
    if (!renaming) return
    for (const row of transaction.select().from(workflows).all()) {
      const definition = JSON.parse(row.definition) as unknown
      const parsed = WorkflowGraphSchema.safeParse(definition)
      if (!parsed.success) continue
      const nextGraph = renameLogicalModelIdInGraph(parsed.data, existing.modelId, nextModelId)
      if (nextGraph === parsed.data) continue
      transaction.update(workflows).set({ definition: JSON.stringify(nextGraph), updatedTime: time }).where(eq(workflows.id, row.id)).run()
    }
    // 规则表住在自己的表里（与 `workflows` 不同表），单独扫一遍。
    for (const row of transaction.select().from(routeRuleSets).all()) {
      const definition = JSON.parse(row.definition) as unknown
      const parsed = RouteRuleSetSchema.safeParse(definition)
      if (!parsed.success) continue
      const nextRuleSet = renameLogicalModelIdInRuleSet(parsed.data, existing.modelId, nextModelId)
      if (nextRuleSet === parsed.data) continue
      transaction.update(routeRuleSets).set({ definition: JSON.stringify(nextRuleSet), updatedTime: time }).where(eq(routeRuleSets.id, row.id)).run()
    }
  })
  const row = db.select().from(logicalModels).where(eq(logicalModels.id, id)).get()
  return mapLogicalModel(row!)
}

/**
 * 软删除一个逻辑模型。
 *
 * 只打 `deletedTime`：被删的行原地留在表里，`modelId` 也原样保留 —— 历史请求记录（观测库）
 * 里那些模型名快照要能对得上一条真实存在过的行，删掉的模型不该在表里变得「查无此人」。
 *
 * 名字的重用不需要在这里做任何事。判据是**活跃行之间不许重复**，
 * 而不是「这个名字历史上出现过没有」：原 `modelId` 从这一刻起就不再被活跃行占用，
 * 用户再建一个同名的就是一次普通的成功。所以这里**不**改写 `modelId`，也不需要墓碑。
 *
 * 数据记录 id 更是一动不动，因此 `scheduling_policies` 的外键一行都不用搬
 * （它指着的是那把稳定的钥匙），要做的只是就地关掉这些绑定，再按记录 id 硬删除它们
 * —— 绑定是该逻辑模型私有的编排，它已经不存在了，留着一行已删除的绑定没有任何读者。
 *
 * 内建默认逻辑模型不允许删除：它是所有兜底落点的归宿。
 */
export async function deleteLogicalModel(id: string): Promise<void> {
  const db = getConfigDb()
  const time = now()
  db.transaction(transaction => {
    const existing = transaction.select().from(logicalModels).where(and(eq(logicalModels.id, id), isNull(logicalModels.deletedTime))).get()
    if (!existing) throw logicalModelNotFoundError(id)
    if (existing.modelId === BUILT_IN_DEFAULT_LOGICAL_MODEL_ID) throw protectedLogicalModelError(existing.modelId)
    transaction.update(logicalModels)
      .set({ deletedTime: time, updatedTime: time })
      .where(eq(logicalModels.id, id))
      .run()
    // 绑定是逻辑模型私有的编排，跟着记录 id 一起退场（记录 id 永不复用，所以硬删除是安全的）。
    transaction.delete(schedulingPolicies).where(eq(schedulingPolicies.logicalModelId, id)).run()
  })
}

function mapLogicalModel(row: typeof logicalModels.$inferSelect): LogicalModel {
  return {
    id: row.id,
    modelId: row.modelId,
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

/**
 * 按**数据记录 id** 列出调度绑定（可选按某个逻辑模型过滤）。
 *
 * 入参是记录 id，不是模型 id：绑定表外键指着的那把钥匙才是这里的口径。
 */
export async function listSchedulingPolicies(logicalModelRecordId?: string): Promise<SchedulingPolicy[]> {
  const condition = and(isNull(schedulingPolicies.deletedTime), logicalModelRecordId ? eq(schedulingPolicies.logicalModelId, logicalModelRecordId) : undefined)
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
