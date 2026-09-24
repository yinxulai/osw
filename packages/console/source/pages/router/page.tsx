import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowRight,
  CirclePlay,
  Hand,
  Lock,
  LockOpen,
  LocateFixed,
  MousePointer2,
  Plus,
  Save,
} from 'lucide-react'

import { routerApi } from '@/api/router'
import { unwrap } from '@/api/unwrap'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useLogicalModels } from '@/data/logical-models'
import { useRouteMode } from '@/components/route-mode/use-route-mode'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'

import { NodeSelector } from './components/node-selector'
import { WorkflowButton } from './components/workflow-button'
import { PolicyMenu } from './components/policy-menu'
import { RouteModeSwitch } from './components/route-mode-switch'
import { SaveVersionDialog, type VersionDraft } from './components/save-version-dialog'
import { VersionMenu } from './components/version-menu'
import { WorkflowConnectionLine } from './components/workflow-connection-line'
import { WorkflowNodePanel } from './components/workflow-node-panel'
import { resolveInputHints } from './field-hints'
import { policyPresetTextKeys } from './policy-preset-text'
import { buildFlowEdges, layoutRouterNodes, type WorkflowFlowEdge } from './flow-projection'
import { hasSavedVersion, toRouterGraphVersion, toRouterGraphVersions, type RouteVersion } from './route-versions'
import { RouteRulesStudio } from './rules/rules-studio'
import {
  ROUTER_POLICY_PRESETS,
  createDefaultPolicyGraph,
  createNodeByKind,
  isSameGraph,
  samplePayload,
  withFixedNodeCopy,
  type RouterPolicyPreset,
} from '@common/router/presets'
import {
  appendNode,
  cloneNode,
  connectEdge,
  insertNode,
  removeEdges,
  removeNode,
  resolveInsertAnchor,
} from './graph-ops'
import {
  isProtectedNode,
  resolveNoteNodeSize,
  toCanvasNodeType,
} from './node-meta'
import type { NodeInsertRequest, NodeRunStatus, RouteFlowNode } from './node-data'
import { edgeTypes, nodeTypes } from './node-registry'
import type { AppendableKind, NodePosition, NoteNodeSize, WorkflowGraph, WorkflowNodeModel, WorkflowRunResult } from '@common/router/types'

/** 这些元素自身消费删除键，画布的键盘删除需要跳过。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 画布内容没有来源版本（内建默认策略、套用预设）时，保存弹窗的输入初值。 */
const EMPTY_VERSION_DRAFT: VersionDraft = { name: '', description: '' }

/** 内建默认策略的 id：一版都没保存过时，代理跑的就是它，画布铺的也是这张图。 */
const DEFAULT_POLICY_PRESET_ID = ROUTER_POLICY_PRESETS.find(preset => preset.isDefault)?.id

/** 单条节点输出的值转成一行文本：字符串直出，数组用逗号连接，其余走 JSON。 */
function formatNodeOutputValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.length === 0 ? '—' : value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ')
  }
  return JSON.stringify(value)
}

/** 服务端返回的图直接铺到画布上：补齐固定节点文案，并按分层算法重排坐标。 */
function toCanvasGraph(graph: WorkflowGraph): WorkflowGraph {
  return { ...graph, nodes: withFixedNodeCopy(layoutRouterNodes(graph.nodes)) }
}

/** 插入节点的落点：在两端点之间取中点，否则排在来源节点右侧。 */
function resolveInsertPosition(source: WorkflowNodeModel | null, target: WorkflowNodeModel | null): NodePosition {
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

function WorkflowStudioCanvas() {
  const flow = useReactFlow<RouteFlowNode, WorkflowFlowEdge>()
  const toast = useToast()
  const t = useTranslation()
  const logicalModels = useLogicalModels()
  /**
   * 预设生成与测试运行共用的逻辑模型列表。
   *
   * 预设的落点在生成时就要定成真实 id，所以它必须拿到当前这份列表；
   * 测试运行的负载也注入同一份，两侧看到的模型完全一致。
   */
  const runtimeLogicalModels = useMemo(
    () => logicalModels.map(model => ({ id: model.id, name: model.name, enabled: model.enabled })),
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

  const [dockMode, setDockMode] = useState<'select' | 'pan'>('select')
  const [dragEnabled, setDragEnabled] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(420)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(samplePayload, null, 2))
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

  /**
   * 测试输入框的行数随内容增长（上限 28 行），剩下的交给抽屉整体滚动。
   * 这样小窗口里不会出现「输入框自己滚 + 结果区自己滚」的双滚动条。
   */
  const payloadRows = useMemo(
    () => Math.min(28, Math.max(8, payloadText.split('\n').length + 1)),
    [payloadText],
  )

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 620 })

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return

    const update = () => {
      const rect = element.getBoundingClientRect()
      const next = {
        width: rect.width,
        height: Math.max(420, window.innerHeight - rect.top - 28),
      }
      // 量出来的高度会作为 inline style 写回这个元素自己，而它同时又是被观察的对象：
      // 「量一次 → 重渲染 → 改高度 → ResizeObserver 再触发 → 再量一次」。
      // 值没变时必须跳过写 state，否则窗口拖拽期间每帧都多一次全画布重渲染。
      setCanvasSize(current => (current.width === next.width && current.height === next.height ? current : next))
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

    const newNode = createNodeByKind(request.kind, resolveInsertPosition(source, target))

    setGraph(latest => {
      const next = insertNode(latest, anchor, newNode)
      return { ...next, nodes: withFixedNodeCopy(next.nodes) }
    })
    setSelectedNodeId(newNode.id)
  }, [])

  const handleInsertOnEdge = useCallback((edgeId: string, kind: AppendableKind) => {
    handleRequestInsert({ kind, edgeId })
  }, [handleRequestInsert])

  const appendAtCanvasCenter = useCallback((kind: AppendableKind) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const position = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }

    const node = createNodeByKind(kind, position)
    setGraph(current => ({ ...appendNode(current, node) }))
    setSelectedNodeId(node.id)
  }, [flow])

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

    const clone = cloneNode(node)
    setGraph(current => ({ ...appendNode(current, clone) }))
    setSelectedNodeId(clone.id)
  }, [])

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

  const runStatusByNode = useMemo(() => {
    const map = new Map<string, NodeRunStatus>()
    if (!runResult) return map
    runResult.trace.forEach(item => map.set(item.nodeId, item.success ? 'succeeded' : 'failed'))
    return map
  }, [runResult])

  /**
   * 运行结果按节点分组呈现。
   * 数据本身挂在节点 id 上（同一节点可能产出多条），所以这里只负责把 id 翻译成节点名称。
   */
  const nodeOutputGroups = useMemo(() => {
    if (!runResult) return []
    const nameById = new Map(graph.nodes.map(node => [node.id, node.name]))
    return Object.entries(runResult.nodeOutputs).map(([nodeId, outputs]) => ({
      nodeId,
      nodeName: nameById.get(nodeId) ?? nodeId,
      outputs,
    }))
  }, [graph.nodes, runResult])

  const nodeCacheRef = useRef(new Map<string, { model: WorkflowNodeModel; flags: string; node: RouteFlowNode }>())

  const flowNodes = useMemo<RouteFlowNode[]>(() => {
    const draggable = dragEnabled && dockMode === 'select'
    const previous = nodeCacheRef.current
    const next = new Map<string, { model: WorkflowNodeModel; flags: string; node: RouteFlowNode }>()

    const nodes = graph.nodes.map(model => {
      const sourcePorts = graph.edges
        .filter(edge => edge.sourceNodeId === model.id)
        .map(edge => String(edge.sourcePort))
      const targetConnected = graph.edges.some(edge => edge.targetNodeId === model.id)
      const runStatus = runStatusByNode.get(model.id) ?? 'idle'
      // 尺寸必须参与缓存键：React Flow 是异步量节点的，首帧量到的是 undefined，
      // 之后才拿到真实尺寸。不把它算进来的话，缓存会一直拿首次那个 `measured: undefined` 的对象，
      // 后续 `adoptUserNodes` 重建内部节点时尺寸就被抹平（拖动时报 error015、fitView 拿到 0 尺寸）。
      const measured = flow.getInternalNode(model.id)?.measured
      // 便签是唯一一个尺寸不等于内容的节点：它的大小由 `model.size` 说了算，
      // 所以要把尺寸同时写成 `measured` 与节点样式（`getNodeInlineStyleDimensions` 只认 style / width，不认 measured）。
      // 其余节点不写 style，宽度交给卡片自己（`w-60`）。
      const noteSize = model.kind === 'note' ? resolveNoteNodeSize(model) : null
      const noteDimensions = noteSize ? { width: noteSize.width, height: noteSize.height } : undefined
      const flags = `${model.id === selectedNodeId}|${draggable}|${runStatus}|${sourcePorts.join(',')}|${targetConnected}|${measured?.width ?? 0}x${measured?.height ?? 0}`

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
        // 尺寸带回来，尺寸会被重置成 undefined：`calculateNodePosition` 会打印 error015
        // （“trying to drag a node that is not initialized”），框选 / fitView 等几何计算
        // 也会拿到 0 尺寸。
        measured: noteDimensions ?? measured,
        style: noteDimensions,
        draggable,
        data: {
          model,
          isSelected: model.id === selectedNodeId,
          runStatus,
          connectedSourcePorts: [...new Set(sourcePorts)],
          targetConnected,
          canInsert: true,
          onOpen: handleOpenNode,
          onUpdateNode: updateNode,
          onResizeNode: handleResizeNode,
          onRequestInsert: handleRequestInsert,
          onDeleteNode: handleDeleteNode,
          onDuplicateNode: handleDuplicateNode,
        },
      }

      next.set(model.id, { model, flags, node })
      return node
    })

    nodeCacheRef.current = next
    return nodes
  }, [
    dragEnabled,
    dockMode,
    flow,
    graph,
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
      // maxZoom 限制在 1：图较小时 fitView 会放大到 1.5 倍并溢出可视区，
      // 首屏应该能一眼看完整个图。
      void flow.fitView({ padding: 0.25, maxZoom: 1 })
    })
    return () => cancelAnimationFrame(frame)
  }, [flow])

  // ---- 选中节点与字段提示 --------------------------------------------------

  const selectedNode = useMemo(
    () => graph.nodes.find(node => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  )

  const conditionFieldHints = useMemo(() => {
    if (!selectedNode) return []
    // 条件节点用它挑字段，逻辑模型选择节点用它挑「变量取值」的来源字段，
    // 遍历迭代节点用它挑遍历来源与结果写回路径，脚本与 LLM 节点用它挑结果写回路径。
    if (
      selectedNode.kind !== 'condition'
      && selectedNode.kind !== 'model-select'
      && selectedNode.kind !== 'iteration'
      && selectedNode.kind !== 'script'
      && selectedNode.kind !== 'prompt'
    ) return []
    return resolveInputHints(t, graph, selectedNode.id).fields
  }, [graph, selectedNode, t])

  // ---- 运行与保存 ----------------------------------------------------------

  const runLocalTest = useCallback(async () => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      const normalizedPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
      normalizedPayload.logicalModels = runtimeLogicalModels

      const result = await unwrap(routerApi.run(graph, normalizedPayload))
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
      const snapshot = await unwrap(routerApi.getGraphVersion(version.sequence))
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

  /**
   * 这一次保存会拿到的版本号。
   *
   * 取自本地版本列表的第一项（服务端按新的在前返回）而不是 `activeGraph`：后者在「一版都没存过」
   * 时是 `null`，取不到号。列表为空时就是首版。
   *
   * 它也是保存弹窗初值所属的那一版：两者都以「最新保存的一版」为准。
   */
  const nextVersion = (versions[0]?.sequence ?? 0) + 1

  const draggable = dragEnabled && dockMode === 'select'

  return (
    <PageLayout>
      <PageHeader
        title={t('router.workflow.title')}
        // 模式切换紧跟在标题后面：它在回答「这个标题指的是哪一种定义」，而不是一个页面动作。
        titleAdornment={<RouteModeSwitch />}
        description={t('router.workflow.description')}
        // 说明文案保持单行截断：标题栏高度固定，画布高度才不会随文案换行变化。
        className="[&_p]:truncate"
        actions={(
          // 标题栏不提供 gap，两个按钮直接放在 Fragment 里会贴在一起。
          <div className="flex items-center gap-2">
            <PolicyMenu activePolicyId={activePolicyId} onApply={applyPolicy} />
            <WorkflowButton size="medium" onClick={() => setTestDrawerOpen(true)}>
              <CirclePlay className="size-3.5" aria-hidden /> {t('router.workflow.run')}
            </WorkflowButton>
            <WorkflowButton size="medium" variant="primary" onClick={() => setSaveDialogOpen(true)} disabled={!canSaveWorkflow}>
              <Save className="size-3.5" aria-hidden /> {t('router.save')}
            </WorkflowButton>
            <VersionMenu versions={versions} itemUnitKey="router.version.unit.nodes" onRestore={restoreVersion} />
          </div>
        )}
      />

      <PageContent>
        {/* 画布上不放图例行：节点名与配色在节点本身与节点选择器里已经出现一次，
            再列一行只是把同样的话说第二遍，白占画布上方的纵向空间。 */}
        <Card className="w-full ring-0">
          <CardContent>
            <div
              ref={canvasRef}
              className="relative w-full overflow-hidden rounded-xl bg-workflow-canvas-workflow-bg"
              style={{ height: canvasSize.height }}
            >
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                connectionLineComponent={WorkflowConnectionLine}
                defaultEdgeOptions={{ type: 'workflow' }}
                proOptions={{ hideAttribution: true }}
                onlyRenderVisibleElements
                snapToGrid
                snapGrid={[16, 16]}
                nodeDragThreshold={1}
                nodesDraggable={draggable}
                panOnDrag={dockMode === 'pan'}
                selectionOnDrag={dockMode === 'select'}
                selectionMode={SelectionMode.Partial}
                deleteKeyCode={null}
                multiSelectionKeyCode={null}
                selectionKeyCode={null}
                minZoom={0.25}
                onConnect={handleConnect}
                onEdgesDelete={handleEdgesDelete}
                onNodesDelete={handleNodesDelete}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                onNodeMouseEnter={handleNodeMouseEnter}
                onNodeMouseLeave={handleNodeMouseLeave}
                onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                className="workflow-reactflow workflow-ui-surface"
              >
                {/* 点阵参数与底色逐字复制自上游 `workflow/index.tsx` 的 <Background>。 */}
                <Background
                  gap={[14, 14]}
                  size={2}
                  className="bg-workflow-canvas-workflow-bg"
                  color="var(--color-workflow-canvas-workflow-dot-color)"
                />
                <Controls className="router-controls" showInteractive={false} />
              </ReactFlow>

              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                {/* 容器样式对齐上游 `workflow/operator/control.tsx` 的悬浮控制条：
                    actionbar 底色与画布只差一档明度，因此保留上游的 0.5px 描边、省略阴影。 */}
                <div className="pointer-events-auto inline-flex max-w-full items-center gap-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary backdrop-blur-[5px]">
                  <NodeSelector
                    placement="top"
                    onSelect={appendAtCanvasCenter}
                    trigger={(
                      <button
                        type="button"
                        aria-label={t('router.canvas.addNodeAria')}
                        className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>
                    )}
                  />

                  <Separator orientation="vertical" className="mx-1!" />

                  <button
                    type="button"
                    aria-label={t('router.canvas.selectModeAria')}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors',
                      dockMode === 'select' ? 'bg-state-accent-solid text-components-button-primary-text' : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                    )}
                    onClick={() => setDockMode('select')}
                  >
                    <MousePointer2 className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('router.canvas.panModeAria')}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors',
                      dockMode === 'pan' ? 'bg-state-accent-solid text-components-button-primary-text' : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                    )}
                    onClick={() => setDockMode('pan')}
                  >
                    <Hand className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={dragEnabled ? t('router.canvas.lockAria') : t('router.canvas.unlockAria')}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors',
                      dragEnabled ? 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary' : 'bg-state-accent-solid text-components-button-primary-text',
                    )}
                    onClick={() => setDragEnabled(value => !value)}
                  >
                    {dragEnabled ? <LockOpen className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                  </button>

                  <Separator orientation="vertical" className="mx-1!" />

                  <button
                    type="button"
                    aria-label={t('router.canvas.fitViewAria')}
                    className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
                    onClick={() => void flow.fitView({ padding: 0.25, maxZoom: 1 })}
                  >
                    <LocateFixed className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>

              {selectedNode && (
                <WorkflowNodePanel
                  model={selectedNode}
                  canvasWidth={canvasSize.width}
                  width={panelWidth}
                  onWidthChange={setPanelWidth}
                  nodeModels={graph.nodes}
                  logicalModels={logicalModels}
                  conditionFieldHints={conditionFieldHints}
                  updateNode={updateNode}
                  onDelete={handleDeleteNode}
                  onClose={() => setSelectedNodeId(null)}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </PageContent>

      <Drawer open={testDrawerOpen} onOpenChange={setTestDrawerOpen} direction="right">
        <DrawerContent className="workflow-test-drawer workflow-ui-surface h-full w-208! max-w-[90vw]! border-l-[0.5px] border-components-panel-border bg-components-panel-bg">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> {t('router.workflow.run')}</DrawerTitle>
            <DrawerDescription>{t('router.runPanel.description')}</DrawerDescription>
          </DrawerHeader>

          {/* 输入与结果共用一个滚动容器：窗口变小时整体滚动，
              而不是输入区、结果区各滚各的（结果里的 Trace 也不再单独滚动）。 */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              <div className="py-1 system-sm-medium text-text-secondary">{t('router.runPanel.inputTitle')}</div>
              <Textarea
                value={payloadText}
                onChange={event => setPayloadText(event.target.value)}
                rows={payloadRows}
                className="min-h-24 resize-none font-mono text-[12px] leading-5"
              />
              {payloadError && <div className="system-xs-regular text-text-destructive">{payloadError}</div>}
            </div>

            <div className="flex flex-col gap-3">
              <div className="py-1 system-sm-medium text-text-secondary">{t('router.runPanel.resultTitle')}</div>
              {!runResult && <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg p-3 system-xs-regular text-text-tertiary">{t('router.runPanel.emptyResult')}</div>}

              {runResult && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={runResult.stopReason === 'output' ? 'success' : 'warning'}>
                      {t('router.runPanel.routeStatus')}{runResult.stopReason === 'output' ? t('router.runPanel.reachedOutput') : runResult.stopReason}
                    </Badge>
                    <Badge variant="info">{t('router.runPanel.protocol')}{runResult.protocol}</Badge>
                    <Badge variant="muted">{t('router.runPanel.nodeCount')}{runResult.trace.length}</Badge>
                  </div>
                  <div className="space-y-1.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2">
                    <div className="system-2xs-medium-uppercase text-text-tertiary">{t('router.runPanel.nodeOutputs')}</div>
                    {nodeOutputGroups.length === 0
                      ? <div className="system-xs-regular text-text-tertiary">{t('router.runPanel.noNodeOutputs')}</div>
                      : (
                        <div className="space-y-1.5">
                          {nodeOutputGroups.map(group => (
                            <div key={group.nodeId} className="rounded-md border border-module-border bg-workflow-block-bg p-2">
                              <div className="mb-1 flex items-center gap-2">
                                <span className="system-xs-medium text-text-primary">{group.nodeName}</span>
                                <span className="font-mono system-2xs-regular text-text-tertiary">{group.nodeId}</span>
                              </div>
                              <div className="space-y-0.5">
                                {group.outputs.map((output, index) => (
                                  <div key={`${output.name}-${index}`} className="flex items-start gap-2">
                                    <span className="shrink-0 system-xs-regular text-text-tertiary">{output.name}</span>
                                    <span className="min-w-0 flex-1 break-all font-mono system-2xs-regular text-text-secondary">
                                      {formatNodeOutputValue(output.value)}
                                    </span>
                                    {output.note && <Badge variant="muted">{output.note}</Badge>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                  <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg p-2 font-mono system-2xs-regular">
                    <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">Output</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.outputPayload, null, 2)}</pre>
                  </div>
                  <div className="space-y-1.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2">
                    <div className="system-2xs-medium-uppercase text-text-tertiary">Trace</div>
                    <div className="space-y-1.5">
                      {runResult.trace.map(item => (
                        <div key={`${item.nodeId}-${item.message}`} className="rounded-md border border-module-border bg-workflow-block-bg p-2 system-xs-regular">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="system-xs-medium text-text-primary">{item.nodeName}</span>
                            <Badge variant={item.success ? 'success' : 'warning'}>{item.kind}</Badge>
                          </div>
                          <div className="text-text-tertiary">{item.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <DrawerFooter className="flex-row justify-end">
            {/* 关闭在左、主操作在右：与规则模式那个试运行抽屉摆同一个位置，换个模式不用重新找按钮。 */}
            <WorkflowButton size="medium" onClick={() => setTestDrawerOpen(false)}>{t('common.action.close')}</WorkflowButton>
            <WorkflowButton size="medium" variant="primary" onClick={runLocalTest}>{t('router.runPanel.run')}</WorkflowButton>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* 弹窗挂在画布之外：它只负责收集名字与说明，图数据仍然由页面这一层持有。 */}
      <SaveVersionDialog
        open={saveDialogOpen}
        nextVersion={nextVersion}
        description={t('router.saveDialog.description')}
        initialName={versionDraftDefaults.name}
        initialDescription={versionDraftDefaults.description}
        saving={saving}
        onOpenChange={setSaveDialogOpen}
        onConfirm={draft => void saveWorkflow(draft)}
      />
    </PageLayout>
  )
}

export function RouterPage() {
  const { mode } = useRouteMode()

  /**
   * 两个工作台按当前生效的模式二选一挂载，而不是同时挂着再藏一个。
   *
   * 未生效的那份定义因此连拉取都不会发生 —— 「同一时刻只有一种生效」在界面上就是这条规则。
   * 模式本身由页头的 `RouteModeSwitch` 自己读、自己开弹窗，不再经由这一层往下传。
   */
  if (mode === 'rules') {
    return <RouteRulesStudio />
  }

  return (
    <ReactFlowProvider>
      <WorkflowStudioCanvas />
    </ReactFlowProvider>
  )
}
