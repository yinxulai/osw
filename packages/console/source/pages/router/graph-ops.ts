import { createId } from '@common/router/presets'
import type { NodeInsertRequest } from './node-data'
import type { NodePosition, WorkflowEdge, WorkflowGraph, WorkflowNodeModel } from '@common/router/types'

/** 端口的唯一定位键：一个 source 端口最多只能有一条出边（与引擎的 Map 语义一致）。 */
export function portKey(sourceNodeId: string, sourcePort: string): string {
  return `${sourceNodeId}:${sourcePort}`
}

function edgeId(sourceNodeId: string, sourcePort: string, targetNodeId: string): string {
  return `${sourceNodeId}:${sourcePort}->${targetNodeId}`
}

/** 新增节点默认用于「继续往下走」的端口。 */
export function primarySourcePort(node: WorkflowNodeModel): string | null {
  switch (node.kind) {
    case 'input':
    case 'control-input':
    case 'model-select':
    case 'iteration':
    case 'script':
    case 'prompt':
      return 'out'
    case 'condition':
      return node.cases[0]?.id ?? 'else'
    case 'protocol-discovery':
      return 'unknown'
    case 'note':
    case 'output':
      return null
  }
}

/** 插入锚点：接在哪个端口后面，以及原本的下游是谁。 */
export type InsertAnchor = {
  sourceNodeId: string
  sourcePort: string
  targetNodeId: string | null
}

/** 把插入请求解析成「接在哪个端口后面」以及「原本指向谁」。 */
export function resolveInsertAnchor(graph: WorkflowGraph, request: NodeInsertRequest): InsertAnchor | null {
  if ('edgeId' in request) {
    const edge = graph.edges.find(item => item.id === request.edgeId)
    if (!edge) return null
    return {
      sourceNodeId: edge.sourceNodeId,
      sourcePort: String(edge.sourcePort),
      targetNodeId: edge.targetNodeId,
    }
  }

  const source = graph.nodes.find(node => node.id === request.prevNodeId)
  if (!source) return null
  const existing = graph.edges.find(
    edge => edge.sourceNodeId === source.id && String(edge.sourcePort) === request.prevSourcePort,
  )

  return {
    sourceNodeId: source.id,
    sourcePort: request.prevSourcePort,
    targetNodeId: existing?.targetNodeId ?? null,
  }
}

/** 在端口后面插入节点：原连线被替换为 A → 新节点 →（原来的下游）。 */
export function insertNode(graph: WorkflowGraph, anchor: InsertAnchor, newNode: WorkflowNodeModel): WorkflowGraph {
  // 备注节点没有任何端口，接上连线只会得到一根插不到东西的线：
  // 「插在边上」对它而言就等于「放在那个位置」，直接并列放上去。
  if (newNode.kind === 'note') return appendNode(graph, newNode)

  const replaced = graph.edges.filter(
    edge => portKey(edge.sourceNodeId, String(edge.sourcePort)) !== portKey(anchor.sourceNodeId, anchor.sourcePort),
  )

  const edges: WorkflowEdge[] = [
    ...replaced,
    {
      id: edgeId(anchor.sourceNodeId, anchor.sourcePort, newNode.id),
      sourceNodeId: anchor.sourceNodeId,
      sourcePort: anchor.sourcePort,
      targetNodeId: newNode.id,
    },
  ]

  const continuePort = primarySourcePort(newNode)
  if (continuePort && anchor.targetNodeId) {
    edges.push({
      id: edgeId(newNode.id, continuePort, anchor.targetNodeId),
      sourceNodeId: newNode.id,
      sourcePort: continuePort,
      targetNodeId: anchor.targetNodeId,
    })
  }

  return {
    ...graph,
    nodes: [...graph.nodes, newNode],
    edges,
  }
}

/** 追加节点到画布，不建立任何连线。 */
export function appendNode(graph: WorkflowGraph, newNode: WorkflowNodeModel): WorkflowGraph {
  return { ...graph, nodes: [...graph.nodes, newNode] }
}

/**
 * 删除节点。
 * 若被删节点恰有一条出边，则把它的上游直接接到下游（等价于「穿透删除」）；
 * 否则断开上游连线，避免产生无法判定的目标。
 */
export function removeNode(graph: WorkflowGraph, nodeId: string): WorkflowGraph {
  const incoming = graph.edges.filter(edge => edge.targetNodeId === nodeId)
  const outgoing = graph.edges.filter(edge => edge.sourceNodeId === nodeId)

  const remaining = graph.edges.filter(
    edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
  )

  const bridge = outgoing.length === 1 ? outgoing[0] : null
  const seen = new Set(remaining.map(edge => portKey(edge.sourceNodeId, String(edge.sourcePort))))
  const rewired: WorkflowEdge[] = []

  if (bridge) {
    for (const edge of incoming) {
      if (edge.sourceNodeId === bridge.targetNodeId) continue
      const key = portKey(edge.sourceNodeId, String(edge.sourcePort))
      if (seen.has(key)) continue
      seen.add(key)
      rewired.push({
        ...edge,
        id: edgeId(edge.sourceNodeId, String(edge.sourcePort), bridge.targetNodeId),
        targetNodeId: bridge.targetNodeId,
      })
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.filter(node => node.id !== nodeId),
    edges: [...remaining, ...rewired],
  }
}

/** 复制节点：为控制项 / 条件分支生成新的 id，避免与新节点内部引用冲突。 */
export function cloneNode(node: WorkflowNodeModel): WorkflowNodeModel {
  const position = { x: node.position.x + 48, y: node.position.y + 48 }

  if (node.kind === 'control-input') {
    return {
      ...node,
      id: createId('control-input'),
      position,
      controls: node.controls.map(control => ({ ...control, id: createId('control') })),
    }
  }

  if (node.kind === 'condition') {
    return {
      ...node,
      id: createId('condition'),
      position,
      cases: node.cases.map(item => ({ ...item, id: createId('case') })),
    }
  }

  return { ...node, id: createId(node.kind), position }
}

/** 连接：同一 source 端口只保留一条出边，重复连接会改写目标。 */
export function connectEdge(graph: WorkflowGraph, sourceNodeId: string, sourcePort: string, targetNodeId: string): WorkflowGraph {
  if (sourceNodeId === targetNodeId) return graph

  const key = portKey(sourceNodeId, sourcePort)
  const existing = graph.edges.find(edge => portKey(edge.sourceNodeId, String(edge.sourcePort)) === key)

  if (existing) {
    if (existing.targetNodeId === targetNodeId) return graph
    return {
      ...graph,
      edges: graph.edges.map(edge => edge.id === existing.id ? { ...edge, targetNodeId } : edge),
    }
  }

  return {
    ...graph,
    edges: [
      ...graph.edges,
      { id: edgeId(sourceNodeId, sourcePort, targetNodeId), sourceNodeId, sourcePort, targetNodeId },
    ],
  }
}

/** 删除连线。 */
export function removeEdges(graph: WorkflowGraph, edgeIds: string[]): WorkflowGraph {
  const removing = new Set(edgeIds)
  return { ...graph, edges: graph.edges.filter(edge => !removing.has(edge.id)) }
}

/**
 * 插入节点的落点：在两端点之间取中点，否则排在来源节点右侧。
 *
 * 与图数据操作放在一起，是因为它服务的就是「插入」这一个动作 —— 两个端点分别对应
 * 连线上插入（前后各一个节点）与端口插入（只有来源）。两个都没有时落在原点，
 * 反正调用方紧接着会把它挪到画布中心（`appendAtCanvasCenter`）。
 */
export function resolveInsertPosition(source: WorkflowNodeModel | null, target: WorkflowNodeModel | null): NodePosition {
  if (source && target) {
    return {
      x: Math.round((source.position.x + target.position.x) / 2),
      y: Math.round((source.position.y + target.position.y) / 2),
    }
  }
  if (source) {
    return { x: source.position.x + 320, y: source.position.y }
  }
  return { x: 0, y: 0 }
}
