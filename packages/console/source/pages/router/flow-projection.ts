import { MarkerType, type Edge } from '@xyflow/react'

import {
  type AppendableKind,
  type NodePosition,
  type NoteNodeSize,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeModel,
} from '@common/router/types'
import {
  NODE_KIND_ORDER,
  edgeRunStatusStroke,
  edgeStrokeColor,
  resolveNoteNodeSize,
  toCanvasNodeType,
} from './node-meta'
import { withFixedNodeCopy } from '@common/router/presets'
import type { NodeInsertRequest, NodeRunStatus, RouteFlowNode } from './node-data'

/**
 * 路由图的画布投影：把引擎的图数据翻译成 React Flow 的节点位置与连线。
 *
 * 图本身（节点定义、边、四个策略预设、示例输入）定义在 `@common/router` ——
 * 代理运行时读的是同一份定义，所以这里只留「画出来」这一步：
 * 旧数据排布、连线着色、连线上插节点的回调。
 */

/**
 * 旧数据（或空白数据）里节点坐标会挤在一起，这里按节点类型做一次列式布局。
 * 只有在坐标明显聚集时才生效，避免覆盖用户自己的排版。
 */
export function layoutRouterNodes(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  if (nodes.length <= 1) return nodes

  const positions = nodes.map(node => node.position)
  const minX = Math.min(...positions.map(position => position.x))
  const maxX = Math.max(...positions.map(position => position.x))
  const minY = Math.min(...positions.map(position => position.y))
  const maxY = Math.max(...positions.map(position => position.y))

  const clustered = (maxX - minX) < 180 && (maxY - minY) < 180
  if (!clustered) return nodes

  const nodesByKind = new Map<WorkflowNodeKind, WorkflowNodeModel[]>()
  for (const node of nodes) {
    const list = nodesByKind.get(node.kind) ?? []
    list.push(node)
    nodesByKind.set(node.kind, list)
  }

  const layoutMap = new Map<string, NodePosition>()
  const startX = 80
  const startY = 200
  const columnGap = 340
  const rowGap = 200

  NODE_KIND_ORDER.forEach((kind, column) => {
    const list = nodesByKind.get(kind) ?? []
    list.forEach((node, row) => {
      layoutMap.set(node.id, {
        x: startX + column * columnGap,
        y: startY + row * rowGap,
      })
    })
  })

  return nodes.map(node => ({
    ...node,
    position: layoutMap.get(node.id) ?? node.position,
  }))
}

export type WorkflowEdgeData = {
  /** 端口语义，用于自定义连线着色 */
  sourceKind: WorkflowNodeKind
  sourcePort: string
  /** 空闲态连线基础色 */
  stroke: string
  /** 上游 / 下游节点的运行状态，用于渐变与状态着色 */
  sourceRunStatus: NodeRunStatus
  targetRunStatus: NodeRunStatus
  /** 连线任意一端是当前悬浮的节点（对应上游的 `_connectedNodeIsHovering`） */
  highlighted: boolean
  /** 任意一端节点被禁用时整条线降透明度（对应上游的 `_dimmed`） */
  dimmed: boolean
  /** 是否允许在连线上插入节点 */
  canInsert: boolean
  /** 在连线上插入节点（把新节点接到这条连线的中间） */
  onInsert?: (edgeId: string, kind: AppendableKind) => void
}

export type WorkflowFlowEdge = Edge<WorkflowEdgeData>

export type BuildFlowEdgesOptions = {
  onInsert?: (edgeId: string, kind: AppendableKind) => void
  /** 节点运行状态，用于连线渐变 */
  runStatusByNode?: Map<string, NodeRunStatus>
  /** 当前悬浮的节点 id */
  hoveredNodeId?: string | null
}

/** 服务端返回的图直接铺到画布上：补齐固定节点文案，并按分层算法重排坐标。 */
export function toCanvasGraph(graph: WorkflowGraph): WorkflowGraph {
  return { ...graph, nodes: withFixedNodeCopy(layoutRouterNodes(graph.nodes)) }
}

/**
 * 图数据 → React Flow 边。
 * 端口用显式 id 传递，避免依赖 handle 挂载顺序。
 */
export function buildFlowEdges(graph: WorkflowGraph, options: BuildFlowEdgesOptions = {}): WorkflowFlowEdge[] {
  const kindById = new Map(graph.nodes.map(node => [node.id, node.kind]))
  const enabledById = new Map(graph.nodes.map(node => [node.id, node.enabled]))
  const runStatusByNode = options.runStatusByNode
  const hoveredNodeId = options.hoveredNodeId ?? null

  return graph.edges.map(edge => {
    const sourceKind = kindById.get(edge.sourceNodeId) ?? 'input'
    const stroke = edgeStrokeColor(sourceKind, edge.sourcePort)
    const sourceRunStatus = runStatusByNode?.get(edge.sourceNodeId) ?? 'idle'
    const targetRunStatus = runStatusByNode?.get(edge.targetNodeId) ?? 'idle'
    // 箭头画在终点，所以跟随下游状态色；没有运行过时回落到分支色。
    const markerColor = edgeRunStatusStroke(targetRunStatus) ?? stroke

    return {
      id: edge.id,
      type: 'workflow',
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePort,
      target: edge.targetNodeId,
      targetHandle: 'target',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: markerColor,
      },
      data: {
        sourceKind,
        sourcePort: edge.sourcePort,
        stroke,
        sourceRunStatus,
        targetRunStatus,
        highlighted: hoveredNodeId !== null
          && (edge.sourceNodeId === hoveredNodeId || edge.targetNodeId === hoveredNodeId),
        dimmed: !(enabledById.get(edge.sourceNodeId) ?? true) || !(enabledById.get(edge.targetNodeId) ?? true),
        canInsert: sourceKind !== 'output',
        onInsert: options.onInsert,
      },
    }
  })
}

export interface FlowNodeCacheEntry {
  model: WorkflowNodeModel
  /** 影响渲染结果的全部条件；一样就复用上一次的节点对象。 */
  flags: string
  node: RouteFlowNode
}

export type FlowNodeCache = Map<string, FlowNodeCacheEntry>

export interface FlowNodeHandlers {
  onOpen: (nodeId: string) => void
  onUpdateNode: (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => void
  onResizeNode: (nodeId: string, size: NoteNodeSize) => void
  onRequestInsert: (request: NodeInsertRequest) => void
  onDeleteNode: (nodeId: string) => void
  onDuplicateNode: (nodeId: string) => void
}

export interface BuildFlowNodesOptions {
  /** 要画的节点（画布上显示的那一份文案）。 */
  nodes: readonly WorkflowNodeModel[]
  /** 当前图上的全部连线，用来算端口占用与是否已接入。 */
  edges: readonly WorkflowEdge[]
  selectedNodeId: string | null
  /** 允许拖动（`dragEnabled && dockMode === 'select'`）。 */
  draggable: boolean
  runStatusByNode: ReadonlyMap<string, NodeRunStatus>
  /**
   * React Flow 量到的节点尺寸。
   *
   * 它对**缓存键有影响**：React Flow 是异步量节点的，首帧量到的是 `undefined`，
   * 之后才是真实尺寸；不把尺寸算进缓存键，缓存会一直拿首次那个没有尺寸的对象，
   * 后续 `adoptUserNodes` 重建内部节点时尺寸被抹平（拖动报 error015、fitView 拿到 0 尺寸）。
   */
  measure: (nodeId: string) => { width?: number; height?: number } | undefined
  handlers: FlowNodeHandlers
  /** 上一次的缓存；返回的新缓存交给调用方保存。 */
  cache: FlowNodeCache
}

/**
 * 图数据 + 画布状态 → React Flow 节点，并复用没变的节点对象。
 *
 * 复用不是为了省渲染，而是为了**不打断 React Flow 的状态机**：每帧都换新对象，
 * 它就会把每个节点当成刚挂载，量到的尺寸、正在进行的拖动全丢。
 * `flags` 就是「哪些条件变了」——节点对象本身、选中态、可拖动、运行状态、端口占用、
 * 是否已接入、量到的尺寸；其中任何一项变了才重建。
 */
export function buildFlowNodes(options: BuildFlowNodesOptions): { nodes: RouteFlowNode[]; cache: FlowNodeCache } {
  const previous = options.cache
  const next: FlowNodeCache = new Map()

  const nodes = options.nodes.map(model => {
    const sourcePorts = options.edges
      .filter(edge => edge.sourceNodeId === model.id)
      .map(edge => String(edge.sourcePort))
    const targetConnected = options.edges.some(edge => edge.targetNodeId === model.id)
    const runStatus = options.runStatusByNode.get(model.id) ?? 'idle'
    const measured = options.measure(model.id)
    // 便签是唯一一个尺寸不等于内容的节点：它的大小由 `model.size` 说了算，
    // 所以要把尺寸同时写成 `measured` 与节点样式（`getNodeInlineStyleDimensions` 只认 style / width，不认 measured）。
    // 其余节点不写 style，宽度交给卡片自己（`w-60`）。
    const noteSize = model.kind === 'note' ? resolveNoteNodeSize(model) : null
    const noteDimensions = noteSize ? { width: noteSize.width, height: noteSize.height } : undefined
    const flags = `${model.id === options.selectedNodeId}|${options.draggable}|${runStatus}|${sourcePorts.join(',')}|${targetConnected}|${measured?.width ?? 0}x${measured?.height ?? 0}`

    const cached = previous.get(model.id)
    if (cached && cached.model === model && cached.flags === flags) {
      next.set(model.id, cached)
      return cached.node
    }

    const node: RouteFlowNode = {
      id: model.id,
      type: toCanvasNodeType(model.kind),
      position: model.position,
      // React Flow 把量到的尺寸记在 internal node 上，而 `adoptUserNodes` 重建内部节点时
      // 会直接取用户节点对象的 `measured`。这里重建对象（例如拖动时每帧写回位置）如果不把
      // 尺寸带回来，尺寸会被重置成 undefined。
      measured: noteDimensions ?? measured,
      style: noteDimensions,
      draggable: options.draggable,
      data: {
        model,
        isSelected: model.id === options.selectedNodeId,
        runStatus,
        connectedSourcePorts: [...new Set(sourcePorts)],
        targetConnected,
        canInsert: true,
        ...options.handlers,
      },
    }

    next.set(model.id, { model, flags, node })
    return node
  })

  return { nodes, cache: next }
}
