import { createDefaultPolicyGraph, isSameGraph } from '@common/router/presets'
import { WorkflowGraphSchema } from '@common/router/schemas'
import { UNSAVED_ROUTER_GRAPH_VERSION } from '@common/router/types'
import type { RouterGraphSaveResult, RouterGraphSnapshot, RouterGraphVersionSummary, WorkflowGraph } from '@common/router/types'
import { listLogicalModels } from './logical-model-store'
import { createWorkflow, deleteWorkflow, getLatestWorkflow, getWorkflow, listWorkflows, type WorkflowRecord } from './workflow-store'
import { ROUTER_GRAPH_TYPE } from './workflow-kind'

export { ROUTER_GRAPH_TYPE }

/**
 * 路由图只有一份真相，放在 `workflows` 表里（`type = 'router'`），一行一版、版本号单调递增。
 *
 * 为什么不做「画布本地一份 + 代理内建一份」：那两份一旦分叉，用户看到的路由图与真正
 * 生效的路由图就不再是同一张图，而这类不一致没有任何办法在界面上解释清楚。
 * 这里只保留服务端这一份，画布读它、代理运行时执行它。
 */

/** 保留的版本上限：超出后把最旧的版本软删除，它只是不再出现在版本列表里。 */
export const MAX_ROUTER_GRAPH_VERSIONS = 30

function parseGraph(record: WorkflowRecord): WorkflowGraph | null {
  const parsed = WorkflowGraphSchema.safeParse(record.definition)
  return parsed.success ? parsed.data : null
}

function toSummary(record: WorkflowRecord, graph: WorkflowGraph): RouterGraphVersionSummary {
  return {
    version: record.version,
    name: record.name,
    description: record.description,
    savedAt: record.updatedTime,
    nodeCount: graph.nodes.length,
  }
}

function toSnapshot(record: WorkflowRecord, graph: WorkflowGraph): RouterGraphSnapshot {
  return { graph, version: record.version, savedAt: record.updatedTime }
}

/** 全部已保存版本，新的在前。损坏的版本直接跳过，不让一行坏数据挡住整个版本列表。 */
export async function listRouterGraphVersions(): Promise<RouterGraphVersionSummary[]> {
  const records = (await listWorkflows()).filter(record => record.type === ROUTER_GRAPH_TYPE)
  const summaries: RouterGraphVersionSummary[] = []
  for (const record of records) {
    const graph = parseGraph(record)
    if (!graph) continue
    summaries.push(toSummary(record, graph))
  }
  return summaries
}

/**
 * 最近保存的**可解析**那一版；一版都没保存过时返回 `null`。
 *
 * 这里刻意从头遍历而不是只取最新一行：一行损坏的图数据不应该让代理悄悄退回内建默认策略，
 * 也不应该让画布上刚保存的图凭空消失。版本号仍然取真实的最新行（见 `saveRouterGraphVersion`），
 * 损坏的那一版只是读不出来。
 */
export async function readRouterGraphSnapshot(): Promise<RouterGraphSnapshot | null> {
  const records = (await listWorkflows()).filter(record => record.type === ROUTER_GRAPH_TYPE)
  for (const record of records) {
    const graph = parseGraph(record)
    if (graph) return toSnapshot(record, graph)
  }
  return null
}

/** 按版本号读图；版本不存在、已归档或内容损坏时返回 `null`。 */
export async function readRouterGraphVersion(version: number): Promise<RouterGraphSnapshot | null> {
  const record = await getWorkflow(ROUTER_GRAPH_TYPE, version)
  if (!record || record.deletedTime !== null) return null
  const graph = parseGraph(record)
  return graph ? toSnapshot(record, graph) : null
}

/**
 * 当前**生效**的路由图。
 *
 * 还没人保存过时，用内建默认策略当场生成一张（落点按当前逻辑模型定好）：
 * 「开箱可用」与「用户保存的图」因此走的是同一条执行路径，不存在只在某个分支里才成立的兜底逻辑。
 * 版本号留 `UNSAVED_ROUTER_GRAPH_VERSION` 表示这份图不来自任何已保存版本。
 */
export async function resolveRouterGraph(): Promise<RouterGraphSnapshot> {
  const saved = await readRouterGraphSnapshot()
  if (saved) return saved

  const graph = createDefaultPolicyGraph(await listLogicalModels())
  return { graph, version: UNSAVED_ROUTER_GRAPH_VERSION, savedAt: 0 }
}

/**
 * 保存一版路由图。
 *
 * 内容与最新版本完全一致时不再新增版本，把最新版本号原样回给调用方：
 * 「保存」的语义是「留下一个可回滚的版本」，内容没变还存一版只会把版本列表灌满噪音。
 * 此时用户这次填的名字与说明也一并丢弃 —— 它们描述的是「这一次改动」，而这次并没有改动可描述。
 *
 * 名字与说明都是注记，可以留空（落库即空串）：**版本的身份是 `version` 这个字段，不是名字**。
 * 库里不需要「唯一的名字」，同名了靠版本号区分；所以这里也不生成 `Version 3` 这类兜底名去占位 ——
 * 那样等于把版本号又抄进名字一份，读的人还得反过来从名字里抠版本号。
 */
export async function saveRouterGraphVersion(graph: WorkflowGraph, name: string | undefined, description: string | undefined): Promise<RouterGraphSaveResult> {
  const latest = await getLatestWorkflow(ROUTER_GRAPH_TYPE)
  const latestGraph = latest ? parseGraph(latest) : null
  if (latest && latestGraph && isSameGraph(latestGraph, graph)) {
    return { ...toSummary(latest, latestGraph), created: false }
  }

  const version = latest ? latest.version + 1 : 1
  const record = await createWorkflow({
    type: ROUTER_GRAPH_TYPE,
    version,
    name: name?.trim() ?? '',
    description: description?.trim() ?? '',
    definition: graph,
  })
  await pruneRouterGraphVersions()
  return { ...toSummary(record, graph), created: true }
}

/** 超出上限时软删除最旧的若干版：历史行还在，只是不再参与读取。 */
async function pruneRouterGraphVersions(): Promise<void> {
  const records = (await listWorkflows()).filter(record => record.type === ROUTER_GRAPH_TYPE)
  for (const record of records.slice(MAX_ROUTER_GRAPH_VERSIONS)) {
    await deleteWorkflow(record.id)
  }
}
