import {
  createDefaultRouteRuleSet,
  isSameRouteRuleSet,
  MAX_ROUTE_RULE_VERSIONS,
  RouteRuleSetSchema,
  UNSAVED_ROUTE_RULE_VERSION,
} from '@common/router/route-rules'
import type { RouteRuleSet, RouteRuleSetSaveResult, RouteRuleSetVersionSummary, RouteRuleSnapshot } from '@common/router/route-rules'
import { listLogicalModels } from './logical-model-store'
import { ROUTE_RULE_TYPE } from './workflow-kind'
import { createWorkflow, deleteWorkflow, getLatestWorkflow, getWorkflow, listWorkflows, type WorkflowRecord } from './workflow-store'

export { ROUTE_RULE_TYPE }

/**
 * 路由规则表只有一份真相，放在 `workflows` 表里（`type = 'route-rules'`），一行一版、版本号单调递增。
 *
 * 规则表的生命周期与图**是同一套**：列表上改的是「正在编的这一份」，按下「保存」才生成一个
 * 可回滚的新版本，代理读的永远是「最近保存的那一版」；一版都没保存过时用内建默认表现场跑。
 * 让两边一致不是对称癖：一张按顺序读的清单同样会经过「拖到别的位置、条件还没填完、落点要换一换」
 * 这些中间状态，而列表上正在编的与正在生效的如果能是同一份，任何一个中间状态都直接落到线上请求上，
 * 用户连「我刚才那下算不算数」都没有一个自己按下去的时刻可以参照。
 *
 * 与路由图共用同一张表但**互不相干**：`workflows` 的唯一键是 `(type, version)`，
 * 两种定义各写各的行、各算各的版本号，谁都不会把对方的内容或版本号推走。
 */

function parseRuleSet(record: WorkflowRecord): RouteRuleSet | null {
  const parsed = RouteRuleSetSchema.safeParse(record.definition)
  return parsed.success ? parsed.data : null
}

function toSummary(record: WorkflowRecord, ruleSet: RouteRuleSet): RouteRuleSetVersionSummary {
  return {
    version: record.version,
    name: record.name,
    description: record.description,
    savedAt: record.updatedTime,
    ruleCount: ruleSet.rules.length,
  }
}

function toSnapshot(record: WorkflowRecord, ruleSet: RouteRuleSet): RouteRuleSnapshot {
  return { ruleSet, version: record.version, savedAt: record.updatedTime }
}

/** 全部已保存版本，新的在前。损坏的版本直接跳过，不让一行坏数据挡住整个版本列表。 */
export async function listRouteRuleSetVersions(): Promise<RouteRuleSetVersionSummary[]> {
  const records = (await listWorkflows()).filter(record => record.type === ROUTE_RULE_TYPE)
  const summaries: RouteRuleSetVersionSummary[] = []
  for (const record of records) {
    const ruleSet = parseRuleSet(record)
    if (!ruleSet) continue
    summaries.push(toSummary(record, ruleSet))
  }
  return summaries
}

/**
 * 最近保存的**可解析**那一版；一版都没保存过时返回 `null`。
 *
 * 这里刻意从头遍历而不是只取最新一行：一行损坏的规则表不应该让代理悄悄退回内建默认表，
 * 也不应该让列表里刚保存的那一版凭空消失。版本号仍然取真实的最新行（见 `saveRouteRuleSetVersion`），
 * 损坏的那一版只是读不出来。
 */
export async function readRouteRuleSnapshot(): Promise<RouteRuleSnapshot | null> {
  const records = (await listWorkflows()).filter(record => record.type === ROUTE_RULE_TYPE)
  for (const record of records) {
    const ruleSet = parseRuleSet(record)
    if (ruleSet) return toSnapshot(record, ruleSet)
  }
  return null
}

/** 按版本号读规则表；版本不存在、已归档或内容损坏时返回 `null`。 */
export async function readRouteRuleSetVersion(version: number): Promise<RouteRuleSnapshot | null> {
  const record = await getWorkflow(ROUTE_RULE_TYPE, version)
  if (!record || record.deletedTime !== null) return null
  const ruleSet = parseRuleSet(record)
  return ruleSet ? toSnapshot(record, ruleSet) : null
}

/**
 * 当前**生效**的规则表。
 *
 * 一版都没保存过时，用内建默认表当场生成一份（落点按当前逻辑模型定好）：
 * 「开箱可用」与「用户保存的表」因此走的是同一条执行路径。
 * 版本号留 `UNSAVED_ROUTE_RULE_VERSION` 表示这份表不来自任何已保存版本。
 */
export async function resolveRouteRuleSet(): Promise<RouteRuleSnapshot> {
  const saved = await readRouteRuleSnapshot()
  if (saved) return saved

  const ruleSet = createDefaultRouteRuleSet(await listLogicalModels())
  return { ruleSet, version: UNSAVED_ROUTE_RULE_VERSION, savedAt: 0 }
}

/**
 * 保存一版规则表。
 *
 * 内容与最新版本完全一致时不再新增版本，把最新版本号原样回给调用方：
 * 「保存」的语义是「留下一个可回滚的版本」，内容没变还存一版只会把版本列表灌满噪音。
 * 此时用户这次填的名字与说明也一并丢弃 —— 它们描述的是「这一次改动」，而这次并没有改动可描述。
 *
 * 名字与说明都是注记，可以留空（落库即空串）：**版本的身份是 `version` 这个字段，不是名字**。
 */
export async function saveRouteRuleSetVersion(ruleSet: RouteRuleSet, name: string | undefined, description: string | undefined): Promise<RouteRuleSetSaveResult> {
  const next = RouteRuleSetSchema.parse(ruleSet)
  const latest = await getLatestWorkflow(ROUTE_RULE_TYPE)
  const latestRuleSet = latest ? parseRuleSet(latest) : null
  if (latest && latestRuleSet && isSameRouteRuleSet(latestRuleSet, next)) {
    return { ...toSummary(latest, latestRuleSet), created: false }
  }

  const version = latest ? latest.version + 1 : 1
  const record = await createWorkflow({
    type: ROUTE_RULE_TYPE,
    version,
    name: name?.trim() ?? '',
    description: description?.trim() ?? '',
    definition: next,
  })
  await pruneRouteRuleSetVersions()
  return { ...toSummary(record, next), created: true }
}

/** 超出上限时软删除最旧的若干版：历史行还在，只是不再参与读取。 */
async function pruneRouteRuleSetVersions(): Promise<void> {
  const records = (await listWorkflows()).filter(record => record.type === ROUTE_RULE_TYPE)
  for (const record of records.slice(MAX_ROUTE_RULE_VERSIONS)) {
    await deleteWorkflow(record.id)
  }
}
