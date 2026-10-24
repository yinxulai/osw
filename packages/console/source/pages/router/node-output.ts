import type { NodeOutput, WorkflowNodeModel, WorkflowRunResult } from '@common/router/types'
import type { NodeRunStatus } from './node-data'

/**
 * 一次试运行的**读法**：画布要把「哪个节点什么结局」和「每个节点产出了什么」画出来，
 * 这两件事都不需要 React，也不依赖画布存在。
 *
 * 原先它们是 `page.tsx` 里的一个 `formatXxx` 加两个 `useMemo`；搬到这儿之后，
 * 「节点名查不到时回落到 id」「数组输出用逗号连接」这类口径可以直接断言，
 * 不用先挂一棵 React Flow 树。
 */

/** 单条节点输出的值转成一行文本：字符串直出，数组用逗号连接，其余走 JSON。 */
export function formatNodeOutputValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.length === 0 ? '—' : value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ')
  }
  return JSON.stringify(value)
}

/**
 * 节点 id → 画布上的运行标记。
 *
 * 同一节点在 trace 里可能出现多条（例如条件节点的分支判定与产出），**后出现的以它为准**：
 * trace 是按执行顺序追加的，最后一条就是它的结局。没有 trace 时所有节点都是 `idle`。
 */
export function buildRunStatusByNode(runResult: WorkflowRunResult | null): Map<string, NodeRunStatus> {
  const map = new Map<string, NodeRunStatus>()
  if (!runResult) return map
  runResult.trace.forEach(item => map.set(item.nodeId, item.success ? 'succeeded' : 'failed'))
  return map
}

export interface NodeOutputGroup {
  nodeId: string
  nodeName: string
  outputs: NodeOutput[]
}

/**
 * 运行结果按节点分组呈现。
 * 数据本身挂在节点 id 上（同一节点可能产出多条），所以这里只负责把 id 翻译成节点名称。
 * 名字取的是**画布上显示的那一份**（`displayNodes`），查不到就退回 id —— 结果里出现的
 * 节点一定来自这张图，查不到只可能是图在跑完之后被改了，此时宁可显示 id 也不要空标题。
 */
export function groupNodeOutputs(displayNodes: readonly WorkflowNodeModel[], runResult: WorkflowRunResult | null): NodeOutputGroup[] {
  if (!runResult) return []
  const nameById = new Map(displayNodes.map(node => [node.id, node.name]))
  return Object.entries(runResult.nodeOutputs).map(([nodeId, outputs]) => ({
    nodeId,
    nodeName: nameById.get(nodeId) ?? nodeId,
    outputs,
  }))
}
