import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { useReactFlow, type Connection } from '@xyflow/react'
import { routerApi } from '@/api/router'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useLogicalModels } from '@/data/logical-models'
import { useTranslation } from '@/i18n/provider'
import type { LogicalModel } from '@common/schemas'
import {
  ROUTER_POLICY_PRESETS,
  createDefaultPolicyGraph,
  createNodeByKind,
  isSameGraph,
  withFixedNodeCopy,
  type RouterPolicyPreset,
  type RouterPolicyPresetId,
} from '@common/router/presets'
import type { AppendableKind, NodePosition, NoteNodeSize, WorkflowGraph, WorkflowNodeModel, WorkflowRunResult } from '@common/router/types'
import type { VersionDraft } from './components/save-version-dialog'
import { resolveInputHints, supportsFieldHints } from './field-hints'
import { buildFlowEdges, buildFlowNodes, toCanvasGraph, type FlowNodeCache, type WorkflowFlowEdge } from './flow-projection'
import { appendNode, cloneNode, connectEdge, insertNode, removeEdges, removeNode, resolveInsertAnchor, resolveInsertPosition } from './graph-ops'
import type { NodeInsertRequest, RouteFlowNode } from './node-data'
import { displayWorkflowNode, isProtectedNode, localizeNewNode } from './node-meta'
import { buildRunStatusByNode, groupNodeOutputs, type NodeOutputGroup } from './node-output'
import { policyPresetTextKeys } from './policy-preset-text'
import { hasSavedVersion, nextVersionNumber, toRouterGraphVersion, toRouterGraphVersions, type RouteVersion } from './route-versions'
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

/** 画布内容没有来源版本（内建默认策略、套用预设）时，保存弹窗的输入初值。 */
const EMPTY_VERSION_DRAFT: VersionDraft = { name: '', description: '' }

/** 内建默认策略的 id：一版都没保存过时，代理跑的就是它，画布铺的也是这张图。 */
const DEFAULT_POLICY_PRESET_ID = ROUTER_POLICY_PRESETS.find(preset => preset.isDefault)?.id
const WORKFLOW_FIT_VIEW_OPTIONS = { padding: 0.04, minZoom: 0.66, maxZoom: 1 }

export function useWorkflowStudio(): WorkflowStudioState {
  const flow = useReactFlow<RouteFlowNode, WorkflowFlowEdge>()
  const toast = useToast()
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
  const [versions, setVersions] = useState<RouteVersion[]>([])
  /**
   * 服务端当前生效的那张图 —— 「有没有可保存的改动」以它为基线。
   *
   * `null` 表示画布上这份内容不对应任何已保存版本（一版都没存过时的内建默认策略、或刚套用的预设），
   * 此时它本身就等于一个「有改动」的状态。
   * 载入完成后才允许保存，避免首屏闪一下可点。
   */
  const [activeGraph, setActiveGraph] = useState<WorkflowGraph | null>(null)
  const [graphLoaded, setGraphLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  /**
   * 保存弹窗的输入初值 —— 「画布上这份内容改自哪一版」的名字与说明。
   *
   * 只跟着画布的来源走：首屏载入是当前生效的那一版，载入历史版本就是载入的那一版，
   * 套用预设则清空（预设不是从任何一版改来的）。
   */
  const [versionDraftDefaults, setVersionDraftDefaults] = useState<VersionDraft>(EMPTY_VERSION_DRAFT)

  /**
   * 预设自带的名字与说明，作为保存弹窗的初值。
   *
   * 预设不是从任何一版改来的，沿用上一版的注记只会误导；但「名字留空」同样不好用：
   * 套用「UA 分流」改完直接保存时，本来就白拿一个说得清的名字与说明。
   */
  const presetDraftDefaults = useCallback((presetId: string | undefined): VersionDraft => {
    const textKeys = presetId ? policyPresetTextKeys(presetId) : undefined
    return textKeys
      ? { name: t(textKeys.name), description: t(textKeys.description) }
      : EMPTY_VERSION_DRAFT
  }, [t])

  /**
   * 首屏从服务端拉一次「当前生效的图」与版本列表。
   *
   * 图只有服务端一份：画布打开时看到的，就是代理此刻正在执行的那张；
   * 一版都没保存过时它给的是内建默认策略（版本号 `UNSAVED_ROUTER_GRAPH_VERSION`），
   * 画布因此默认落在「逻辑模型命中」这条规则上，而不是一张空白图。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [snapshot, summaries] = await Promise.all([
          unwrap(routerApi.getGraph()),
          unwrap(routerApi.getGraphVersions()),
        ])
        if (cancelled) return
        const canvasGraph = toCanvasGraph(snapshot.graph)
        setGraph(canvasGraph)
        // 内建默认策略（版本号 0）不是已保存版本：基线留空，画布内容一律算未保存。
        setActiveGraph(hasSavedVersion(snapshot.version) ? canvasGraph : null)
        const loadedVersions = toRouterGraphVersions(summaries)
        setVersions(loadedVersions)
        const baseline = loadedVersions[0]
        // 画布铺的就是最新保存的那一版；一版都没保存过时铺的是内建默认策略，
        // 初值就跟着这张默认策略走 —— 于是打开应用直接保存，拿到的是有名字的「逻辑模型命中」这一版。
        setVersionDraftDefaults(
          hasSavedVersion(snapshot.version) && baseline
            ? { name: baseline.name, description: baseline.description }
            : presetDraftDefaults(DEFAULT_POLICY_PRESET_ID),
        )
      } catch (error) {
        if (cancelled) return
        toast.error(error instanceof Error ? error.message : t('router.error.loadGraph'))
      } finally {
        if (!cancelled) setGraphLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [presetDraftDefaults, toast, t])

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

  // ---- 运行与保存 ----------------------------------------------------------

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

  /**
   * 保存 = 发布一个新版本。
   * 服务端把这一版落库并让它立刻对代理生效（没保存过时代理跑的是内建默认策略）；
   * 内容与最新版本一致时不会重复生成，避免连点保存堆出一串重复版本。
   *
   * 名字与说明是这一次保存的注记，只在真的生成新版本时才会落库（内容没变时一并丢弃）。
   * 出错时故意不关弹窗：用户刚敲进去的东西不能因为一次网络失败就没地方找回来。
   */
  const saveWorkflow = useCallback(async (draft: VersionDraft) => {
    const graphToSave = graphRef.current
    setSaving(true)
    try {
      const result = await unwrap(routerApi.saveGraph(graphToSave, draft.name, draft.description))
      // 存下去的这一版立刻对代理生效，它同时成为「有无改动」的新基线。
      setActiveGraph(graphToSave)
      setSaveDialogOpen(false)
      // 画布的来源换成了刚存的这一版，下次打开弹窗要带出来的就是它。
      const savedVersion = toRouterGraphVersion(result)
      setVersionDraftDefaults({ name: savedVersion.name, description: savedVersion.description })
      if (!result.created) {
        toast.info(t('router.toast.identicalToLatest', { version: result.version }))
        return
      }
      setVersions(current => [savedVersion, ...current])
      toast.success(t('router.toast.versionSaved', { version: result.version }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [toast, t])

  /**
   * 把历史某一版载入画布。
   *
   * 载入只是「拿到编辑起点」：代理仍然跑着当前生效的那一版，直到这里再点一次「保存」。
   * 因此不会像从前那样改了本地副本就等于改了线上行为。
   */
  const restoreVersion = useCallback(async (version: RouteVersion) => {
    try {
      const snapshot = await unwrap(routerApi.getGraphVersion(version.id))
      if (!snapshot) {
        toast.error(t('router.error.versionMissing', { sequence: version.sequence }))
        return
      }
      setGraph(toCanvasGraph(snapshot.graph))
      setSelectedNodeId(null)
      setRunResult(null)
      // 画布换成这一版了，保存时默认接着用它的名字与说明。
      setVersionDraftDefaults({ name: version.name, description: version.description })
      toast.success(t('router.toast.versionLoaded', { sequence: version.sequence }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.restoreFailed'))
    }
  }, [toast, t])

  /**
   * 套用内置策略：整张画布换成预设内容。
   * 预设里没有用户的改动，所以不需要额外确认，但会清掉选中态与上次运行结果；
   * 保存弹窗的初值换成这张预设自己的名字与说明：用户改完直接存，就能得到
   * 「逻辑模型命中」这样的注记，而不是一个没有名字的版本。
   */
  const applyPolicy = useCallback((preset: RouterPolicyPreset) => {
    setGraph(preset.createGraph(runtimeLogicalModels))
    setSelectedNodeId(null)
    setRunResult(null)
    setVersionDraftDefaults(presetDraftDefaults(preset.id))
    const textKeys = policyPresetTextKeys(preset.id)
    toast.success(t('router.toast.policyApplied', { name: textKeys ? t(textKeys.name) : preset.id }))
  }, [presetDraftDefaults, runtimeLogicalModels, toast, t])

  /** 当前画布与哪个预设一致（不一致时为 null）。 */
  const activePolicyId = useMemo(
    () => ROUTER_POLICY_PRESETS.find(preset => isSameGraph(preset.createGraph(runtimeLogicalModels), graph))?.id ?? null,
    [graph, runtimeLogicalModels],
  )

  /**
   * 画布相对「当前生效的那一版」有改动才允许保存。
   *
   * 内容一致时后端本来就不会生成新版本，但按钮常亮会让人以为随时有东西要存；
   * 这里把「有没有可保存的改动」直接做成可用状态，就是保存按钮的语义本身。
   */
  const canSaveWorkflow = graphLoaded && !saving && (activeGraph === null || !isSameGraph(activeGraph, graph))

  // 它也是保存弹窗初值所属的那一版：两者都以「最新保存的一版」为准（见 `nextVersionNumber`）。
  const nextVersion = nextVersionNumber(versions)

  const draggable = dragEnabled && dockMode === 'select'

  return {
    activePolicyId,
    canSave: canSaveWorkflow,
    versions,
    onApplyPolicy: applyPolicy,
    onRestoreVersion: restoreVersion,
    onOpenRun: () => setTestDrawerOpen(true),
    onOpenSave: () => setSaveDialogOpen(true),

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

    saveOpen: saveDialogOpen,
    saveDescription: t('router.saveDialog.description'),
    nextVersion,
    saveInitialName: versionDraftDefaults.name,
    saveInitialDescription: versionDraftDefaults.description,
    saving,
    onSaveOpenChange: setSaveDialogOpen,
    onSaveConfirm: draft => void saveWorkflow(draft),
  }
}
