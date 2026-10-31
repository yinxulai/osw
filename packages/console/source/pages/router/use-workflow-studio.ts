import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { useReactFlow, type Connection } from '@xyflow/react'
import { routerApi } from '@/api/router'
import { unwrap } from '@/api/unwrap'
import { useLogicalModels } from '@/data/logical-models'
import { useTranslation } from '@/i18n/provider'
import type { LogicalModel } from '@common/schemas'
import {
  createDefaultPolicyGraph,
  createNodeByKind,
  withFixedNodeCopy,
  type RouterPolicyPreset,
  type RouterPolicyPresetId,
} from '@common/router/presets'
import type { AppendableKind, NodePosition, NoteNodeSize, WorkflowGraph, WorkflowNodeModel, WorkflowRunResult } from '@common/router/types'
import type { VersionDraft } from './components/save-version-dialog'
import { resolveInputHints, supportsFieldHints } from './field-hints'
import { buildFlowEdges, buildFlowNodes, type FlowNodeCache, type WorkflowFlowEdge } from './flow-projection'
import { appendNode, cloneNode, connectEdge, insertNode, removeEdges, removeNode, resolveInsertAnchor, resolveInsertPosition } from './graph-ops'
import type { NodeInsertRequest, RouteFlowNode } from './node-data'
import { displayWorkflowNode, isProtectedNode, localizeNewNode } from './node-meta'
import { buildRunStatusByNode, groupNodeOutputs, type NodeOutputGroup } from './node-output'
import { useGraphVersioning } from './use-graph-versioning'
import type { RouteVersion } from './route-versions'
import { initialPayloadText, parseRunPayload, payloadRowsFor } from './run-payload'

/**
 * 工作台的状态、副作用与图数据操作。
 *
 * 这里只有「把状态接进 React」这一件事：状态本身是渲染期的界面状态（选中了哪个节点、
 * 画布是选择还是平移、抽屉开没开、输入框里是什么），它的生命周期就是这张页面的生命周期，
 * 因此不做成 `lib/` 里那种普通类 + 订阅 —— 那套写法留给「组件卸载后还要继续存在」的东西
 * （见 `apps/docs/specs/overview/console-architecture.md` §2）。
 *
 * 真正与 React 无关的口径都在 `.ts` 里，各有自己的单测：图的增删改（`graph-ops`）、
 * 服务端摘要与版本号（`route-versions`）、画布投影（`flow-projection`）、试运行负载
 * （`run-payload`）、字段提示的适用节点（`field-hints`）。所以这个文件里没有可被
 * 「纯度闸门」抓到的模块作用域纯函数，页面文件也只剩组合。
 */
export interface WorkflowStudioState {
  // ── 页头 ────────────────────────────────────────────────────────────────
  /** 当前画布与哪个预设一致；`null` 表示已经被改过。 */
  activePolicyId: RouterPolicyPresetId | null
  canSave: boolean
  versions: RouteVersion[]
  onApplyPolicy: (preset: RouterPolicyPreset) => void
  onRestoreVersion: (version: RouteVersion) => void
  onOpenRun: () => void
  onOpenSave: () => void
  // ── 画布 ────────────────────────────────────────────────────────────────
  canvasRef: RefObject<HTMLDivElement | null>
  flowNodes: RouteFlowNode[]
  flowEdges: WorkflowFlowEdge[]
  draggable: boolean
  dockMode: 'select' | 'pan'
  onModeChange: (mode: 'select' | 'pan') => void
  dragEnabled: boolean
  onToggleDrag: () => void
  onFitView: () => void
  onAppendNode: (kind: AppendableKind) => void
  onNodeClick: (event: ReactMouseEvent, node: RouteFlowNode) => void
  onPaneClick: () => void
  onConnect: (connection: Connection) => void
  onEdgesDelete: (edges: WorkflowFlowEdge[]) => void
  onNodesDelete: (nodes: RouteFlowNode[]) => void
  onNodeDrag: (event: MouseEvent | TouchEvent, node: RouteFlowNode) => void
  onNodeDragStop: (event: MouseEvent | TouchEvent, node: RouteFlowNode) => void
  onNodeMouseEnter: (event: ReactMouseEvent, node: RouteFlowNode) => void
  onNodeMouseLeave: () => void
  // ── 节点面板 ────────────────────────────────────────────────────────────
  selectedNode: WorkflowNodeModel | null
  canvasWidth: number
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  nodeModels: WorkflowNodeModel[]
  logicalModels: LogicalModel[]
  conditionFieldHints: ReturnType<typeof resolveInputHints>['fields']
  updateNode: (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => void
  onDeleteNode: (nodeId: string) => void
  onCloseNodePanel: () => void
  // ── 试运行 ──────────────────────────────────────────────────────────────
  runOpen: boolean
  onRunOpenChange: (open: boolean) => void
  payloadText: string
  onPayloadTextChange: (value: string) => void
  payloadError: string
  payloadRows: number
  runResult: WorkflowRunResult | null
  nodeOutputGroups: NodeOutputGroup[]
  onRun: () => void
  // ── 保存 ────────────────────────────────────────────────────────────────
  saveOpen: boolean
  saveDescription: string
  nextVersion: number
  saveInitialName: string
  saveInitialDescription: string
  saving: boolean
  onSaveOpenChange: (open: boolean) => void
  onSaveConfirm: (draft: VersionDraft) => void
}

/** 这些元素自身消费删除键，画布的键盘删除需要跳过。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

const WORKFLOW_FIT_VIEW_OPTIONS = { padding: 0.04, minZoom: 0.66, maxZoom: 1 }

export function useWorkflowStudio(): WorkflowStudioState {
  const flow = useReactFlow<RouteFlowNode, WorkflowFlowEdge>()
  const t = useTranslation()
  const logicalModels = useLogicalModels()
  /**
   * 预设生成与测试运行共用的逻辑模型列表。
   *
   * 预设的落点在生成时就要定成真实的模型 id，所以它必须拿到当前这份列表；
   * 测试运行的负载也注入同一份，两侧看到的模型完全一致。
   * 注意交出去的是 `modelId` 而不是数据记录 id —— 图会被同步到云端，
   * 里面写死的引用只能是可移植的模型名。
   */
  const runtimeLogicalModels = useMemo(
    () => logicalModels.map(model => ({ modelId: model.modelId, description: model.description, enabled: model.enabled })),
    [logicalModels],
  )

  /**
   * 首屏画布初值：内建默认策略本身，落点用当前已知的逻辑模型列表（列表还没到时先为空池）。
   *
   * 图只有服务端一份，下面的 effect 会把「当前生效的图」铺上来；这里只是让首帧有张合法图可画。
   * 用默认策略而不是一张空白骨架：占位期间画布上显示的规则，与代理此刻执行的规则是同一条，
   * 不会出现「打开工作台先看到一张没人执行过的图」。
   */
  const [graph, setGraph] = useState<WorkflowGraph>(() => createDefaultPolicyGraph(runtimeLogicalModels))
  const graphRef = useRef(graph)
  graphRef.current = graph
  const displayNodeCacheRef = useRef(new WeakMap<WorkflowNodeModel, { t: typeof t; node: WorkflowNodeModel }>())
  /** 画布与面板看到的文本副本；图数据本身仍保持内置预设的稳定原文。 */
  const displayNodes = useMemo(
    () => graph.nodes.map((node) => {
      const cached = displayNodeCacheRef.current.get(node)
      if (cached?.t === t) return cached.node

      const displayNode = displayWorkflowNode(t, node)
      displayNodeCacheRef.current.set(node, { t, node: displayNode })
      return displayNode
    }),
    [graph.nodes, t],
  )
  const displayNodeById = useMemo(
    () => new Map(displayNodes.map(node => [node.id, node])),
    [displayNodes],
  )

  const [dockMode, setDockMode] = useState<'select' | 'pan'>('select')
  const [dragEnabled, setDragEnabled] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(420)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(initialPayloadText)
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null)

  /** 整图替换：铺到画布的同时清掉选中态（首屏载入 / 回滚 / 套预设统一经它）。 */
  const loadGraph = useCallback((next: WorkflowGraph) => {
    setGraph(next)
    setSelectedNodeId(null)
  }, [])

  const clearRunResult = useCallback(() => setRunResult(null), [])

  // 版本生命周期（载入 / 保存 / 回滚 / 套策略）拆到 `useGraphVersioning`——与规则模式同一套结构。
  // 它只通过 `loadGraph` / `clearRunResult` 两个回调回写编辑核心，自身状态不参与画布投影。
  const versioning = useGraphVersioning({ graph, graphRef, runtimeLogicalModels, loadGraph, clearRunResult })

  const payloadRows = useMemo(() => payloadRowsFor(payloadText), [payloadText])

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return

    const update = () => {
      const nextWidth = element.clientWidth
      // 高度由 flex 容器决定，这里只记录宽度供节点面板限制拖动范围。
      setCanvasWidth(current => current === nextWidth ? current : nextWidth)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // ---- 图数据操作 ----------------------------------------------------------

  const updateNode = useCallback(
    (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => {
      setGraph(current => ({
        ...current,
        nodes: withFixedNodeCopy(current.nodes.map(node => node.id === nodeId ? updater(node) : node)),
      }))
    },
    [],
  )

  const handleOpenNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
  }, [])

  const handleRequestInsert = useCallback((request: NodeInsertRequest) => {
    const current = graphRef.current
    const anchor = resolveInsertAnchor(current, request)
    if (!anchor) return

    const source = current.nodes.find(node => node.id === anchor.sourceNodeId) ?? null
    const target = anchor.targetNodeId
      ? current.nodes.find(node => node.id === anchor.targetNodeId) ?? null
      : null

    const newNode = localizeNewNode(t, createNodeByKind(request.kind, resolveInsertPosition(source, target)))

    setGraph(latest => {
      const next = insertNode(latest, anchor, newNode)
      return { ...next, nodes: withFixedNodeCopy(next.nodes) }
    })
    setSelectedNodeId(newNode.id)
  }, [t])

  const handleInsertOnEdge = useCallback((edgeId: string, kind: AppendableKind) => {
    handleRequestInsert({ kind, edgeId })
  }, [handleRequestInsert])

  const appendAtCanvasCenter = useCallback((kind: AppendableKind) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const position = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }

    const node = localizeNewNode(t, createNodeByKind(kind, position))
    setGraph(current => ({ ...appendNode(current, node) }))
    setSelectedNodeId(node.id)
  }, [flow, t])

  const handleDeleteNode = useCallback((nodeId: string) => {
    const node = graphRef.current.nodes.find(item => item.id === nodeId)
    if (!node || isProtectedNode(node)) return

    setGraph(current => removeNode(current, nodeId))
    setSelectedNodeId(current => current === nodeId ? null : current)
  }, [])

  /** 键盘删除（Delete / Backspace）走同一条通道，并拦住受保护的输入 / 输出节点。 */
  const handleNodesDelete = useCallback((deleted: RouteFlowNode[]) => {
    const removableIds = deleted
      .filter((deletedNode) => {
        const node = graphRef.current.nodes.find(item => item.id === deletedNode.id)
        return node ? !isProtectedNode(node) : false
      })
      .map(deletedNode => deletedNode.id)
    if (!removableIds.length) return

    setGraph(current => removableIds.reduce((acc, nodeId) => removeNode(acc, nodeId), current))
    setSelectedNodeId(current => current && removableIds.includes(current) ? null : current)
  }, [])

  /**
   * 工作台的选中态由页面自己维护（`selectedNodeId`），React Flow 内部并不知道，
   * 因此 `deleteKeyCode` 交给页面处理：只删除当前选中且不受保护的节点，
   * 输入 / 输出节点以及输入框内的删除一律放行给浏览器。
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (!selectedNodeId) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || EDITABLE_TAGS.has(target.tagName))) return
      const node = graphRef.current.nodes.find(item => item.id === selectedNodeId)
      if (!node || isProtectedNode(node)) return
      event.preventDefault()
      handleDeleteNode(selectedNodeId)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDeleteNode, selectedNodeId])

  const handleNodeMouseEnter = useCallback((_event: ReactMouseEvent, node: RouteFlowNode) => {
    setHoveredNodeId(node.id)
  }, [])

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null)
  }, [])

  const handleDuplicateNode = useCallback((nodeId: string) => {
    const node = graphRef.current.nodes.find(item => item.id === nodeId)
    if (!node) return

    const clone = cloneNode(displayNodeById.get(nodeId) ?? node)
    setGraph(current => ({ ...appendNode(current, clone) }))
    setSelectedNodeId(clone.id)
  }, [displayNodeById])

  const handleConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle } = connection
    if (!source || !target || source === target) return
    setGraph(current => connectEdge(current, source, sourceHandle ?? 'out', target))
  }, [])

  const handleEdgesDelete = useCallback((edges: WorkflowFlowEdge[]) => {
    if (!edges.length) return
    setGraph(current => removeEdges(current, edges.map(edge => edge.id)))
  }, [])

  // ---- 拖拽位置（rAF 节流写回图数据） --------------------------------------

  const dragRafRef = useRef<number | null>(null)
  const pendingDragRef = useRef<{ id: string; position: NodePosition } | null>(null)

  const flushDrag = useCallback(() => {
    dragRafRef.current = null
    const pending = pendingDragRef.current
    if (!pending) return
    pendingDragRef.current = null
    updateNode(pending.id, node => ({ ...node, position: pending.position }))
  }, [updateNode])

  const handleNodeDrag = useCallback((_event: MouseEvent | TouchEvent, node: RouteFlowNode) => {
    pendingDragRef.current = { id: node.id, position: node.position }
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(flushDrag)
  }, [flushDrag])

  const handleNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: RouteFlowNode) => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    pendingDragRef.current = null
    updateNode(node.id, current => ({ ...current, position: node.position }))
  }, [updateNode])

  useEffect(() => () => {
    if (dragRafRef.current !== null) cancelAnimationFrame(dragRafRef.current)
    if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
  }, [])

  // ---- 便签尺寸（同样 rAF 节流） ------------------------------------------

  const resizeRafRef = useRef<number | null>(null)
  const pendingResizeRef = useRef<{ id: string; size: NoteNodeSize } | null>(null)

  const flushResize = useCallback(() => {
    resizeRafRef.current = null
    const pending = pendingResizeRef.current
    if (!pending) return
    pendingResizeRef.current = null
    updateNode(pending.id, node => node.kind === 'note' ? { ...node, size: pending.size } : node)
  }, [updateNode])

  /**
   * 便签拖右下角改尺寸。
   *
   * 与拖动位置同源：拖拽期间指针事件比渲染快，每一下都 `setGraph` 会把整张图重排一遍，
   * 所以还是每帧只写一次。这里不做 `stop` 版的收尾写入 —— 尺寸是绝对值，最后一帧就是终值。
   */
  const handleResizeNode = useCallback((nodeId: string, size: NoteNodeSize) => {
    pendingResizeRef.current = { id: nodeId, size }
    if (resizeRafRef.current !== null) return
    resizeRafRef.current = requestAnimationFrame(flushResize)
  }, [flushResize])

  // ---- React Flow 数据 ----------------------------------------------------

  const runStatusByNode = useMemo(() => buildRunStatusByNode(runResult), [runResult])
  const nodeOutputGroups = useMemo(() => groupNodeOutputs(displayNodes, runResult), [displayNodes, runResult])

  /**
   * 画布上的节点对象。缓存与缓存键都在 `buildFlowNodes` 里：没变的节点复用同一个对象，
   * React Flow 的状态机才不会被每帧的新对象打断（细节见 `flow-projection.ts`）。
   */
  const nodeCacheRef = useRef<FlowNodeCache>(new Map())
  const flowNodes = useMemo(() => {
    const built = buildFlowNodes({
      nodes: displayNodes,
      edges: graph.edges,
      selectedNodeId,
      draggable: dragEnabled && dockMode === 'select',
      runStatusByNode,
      measure: nodeId => flow.getInternalNode(nodeId)?.measured,
      cache: nodeCacheRef.current,
      handlers: {
        onOpen: handleOpenNode,
        onUpdateNode: updateNode,
        onResizeNode: handleResizeNode,
        onRequestInsert: handleRequestInsert,
        onDeleteNode: handleDeleteNode,
        onDuplicateNode: handleDuplicateNode,
      },
    })
    nodeCacheRef.current = built.cache
    return built.nodes
  }, [
    dragEnabled,
    dockMode,
    flow,
    displayNodes,
    graph.edges,
    handleDeleteNode,
    handleDuplicateNode,
    handleOpenNode,
    handleRequestInsert,
    handleResizeNode,
    runStatusByNode,
    selectedNodeId,
    updateNode,
  ])

  const flowEdges = useMemo(
    () => buildFlowEdges(graph, { onInsert: handleInsertOnEdge, runStatusByNode, hoveredNodeId }),
    [graph, handleInsertOnEdge, hoveredNodeId, runStatusByNode],
  )

  const hasFitViewRef = useRef(false)
  useEffect(() => {
    if (hasFitViewRef.current) return
    const frame = requestAnimationFrame(() => {
      hasFitViewRef.current = true
      void flow.fitView(WORKFLOW_FIT_VIEW_OPTIONS)
    })
    return () => cancelAnimationFrame(frame)
  }, [flow])

  // ---- 选中节点与字段提示 --------------------------------------------------

  const selectedNode = useMemo(
    () => selectedNodeId ? displayNodeById.get(selectedNodeId) ?? null : null,
    [displayNodeById, selectedNodeId],
  )

  const conditionFieldHints = useMemo(() => {
    if (!selectedNode || !supportsFieldHints(selectedNode.kind)) return []
    return resolveInputHints(t, graph, selectedNode.id).fields
  }, [graph, selectedNode, t])

  // ---- 运行 ----------------------------------------------------------------

  const runLocalTest = useCallback(async () => {
    try {
      const result = await unwrap(routerApi.run(graph, parseRunPayload(payloadText, runtimeLogicalModels)))
      setRunResult(result)
      setPayloadError('')
    } catch (error) {
      setRunResult(null)
      setPayloadError(error instanceof Error ? error.message : t('router.error.invalidPayload'))
    }
  }, [graph, runtimeLogicalModels, payloadText, t])

  const draggable = dragEnabled && dockMode === 'select'

  return {
    activePolicyId: versioning.activePolicyId,
    canSave: versioning.canSave,
    versions: versioning.versions,
    onApplyPolicy: versioning.applyPolicy,
    onRestoreVersion: versioning.restoreVersion,
    onOpenRun: () => setTestDrawerOpen(true),
    onOpenSave: () => versioning.setSaveDialogOpen(true),

    canvasRef,
    flowNodes,
    flowEdges,
    draggable,
    dockMode,
    onModeChange: setDockMode,
    dragEnabled,
    onToggleDrag: () => setDragEnabled(value => !value),
    onFitView: () => void flow.fitView(WORKFLOW_FIT_VIEW_OPTIONS),
    onAppendNode: appendAtCanvasCenter,
    onNodeClick: (_event, node) => setSelectedNodeId(node.id),
    onPaneClick: () => setSelectedNodeId(null),
    onConnect: handleConnect,
    onEdgesDelete: handleEdgesDelete,
    onNodesDelete: handleNodesDelete,
    onNodeDrag: handleNodeDrag,
    onNodeDragStop: handleNodeDragStop,
    onNodeMouseEnter: handleNodeMouseEnter,
    onNodeMouseLeave: handleNodeMouseLeave,

    selectedNode,
    canvasWidth,
    panelWidth,
    onPanelWidthChange: setPanelWidth,
    nodeModels: displayNodes,
    logicalModels,
    conditionFieldHints,
    updateNode,
    onDeleteNode: handleDeleteNode,
    onCloseNodePanel: () => setSelectedNodeId(null),

    runOpen: testDrawerOpen,
    onRunOpenChange: setTestDrawerOpen,
    payloadText,
    onPayloadTextChange: setPayloadText,
    payloadError,
    payloadRows,
    runResult,
    nodeOutputGroups,
    onRun: runLocalTest,

    saveOpen: versioning.saveDialogOpen,
    saveDescription: t('router.saveDialog.description'),
    nextVersion: versioning.nextVersion,
    saveInitialName: versioning.versionDraftDefaults.name,
    saveInitialDescription: versioning.versionDraftDefaults.description,
    saving: versioning.saving,
    onSaveOpenChange: versioning.setSaveDialogOpen,
    onSaveConfirm: draft => void versioning.saveWorkflow(draft),
  }
}
