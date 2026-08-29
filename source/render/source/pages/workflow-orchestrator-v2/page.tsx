import { useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectStartParams,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, CirclePlay, Plus, Route, SquareTerminal } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { executeWorkflowV2 } from './engine'
import { initialNodes, nodeTemplates, queueOptions, samplePayload } from './fixtures'
import type { V2NodeKind, V2ExecutionResult, WorkflowV2Node } from './types'

interface FlowNodeData extends Record<string, unknown> {
  node: WorkflowV2Node
  nodeIds: string[]
  connectingFrom: { nodeId: string; handleId: string | null } | null
  onChange: (id: string, next: WorkflowV2Node) => void
  onRemove: (id: string) => void
}

function nodeKindLabel(kind: V2NodeKind): string {
  if (kind === 'start') return '输入'
  if (kind === 'context-extract') return '提取'
  if (kind === 'condition') return '条件'
  if (kind === 'modifier') return '请求改写'
  if (kind === 'transformer') return '转换'
  if (kind === 'route-queue') return '路由'
  if (kind === 'dispatch') return '分发'
  if (kind === 'response-mutate') return '响应改写'
  return '输出'
}

function kindTone(kind: V2NodeKind): string {
  if (kind === 'start' || kind === 'end') return 'bg-info/12 text-info'
  if (kind === 'context-extract') return 'bg-info/14 text-info'
  if (kind === 'condition') return 'bg-warning/14 text-warning-foreground'
  if (kind === 'modifier') return 'bg-success/14 text-success-foreground'
  if (kind === 'transformer') return 'bg-primary/12 text-primary'
  if (kind === 'route-queue') return 'bg-muted text-muted-foreground'
  if (kind === 'dispatch') return 'bg-primary/14 text-primary'
  return 'bg-success/12 text-success-foreground'
}

function isLinearNode(node: WorkflowV2Node): node is Extract<WorkflowV2Node, { next: string }> {
  return node.kind === 'start'
    || node.kind === 'context-extract'
    || node.kind === 'modifier'
    || node.kind === 'transformer'
    || node.kind === 'route-queue'
    || node.kind === 'dispatch'
    || node.kind === 'response-mutate'
}

function createNode(kind: V2NodeKind, x: number, y: number): WorkflowV2Node {
  const id = `node-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`

  if (kind === 'context-extract') {
    return {
      id,
      kind,
      name: '上下文提取',
      enabled: true,
      x,
      y,
      sourcePath: 'request.headers.user-agent',
      targetPath: 'vars.ua',
      next: 'end',
    }
  }

  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '条件节点',
      enabled: true,
      x,
      y,
      path: 'vars.ua',
      operator: 'contains',
      value: 'iPhone',
      nextTrue: 'end',
      nextFalse: 'end',
    }
  }

  if (kind === 'modifier') {
    return {
      id,
      kind,
      name: '请求修改',
      enabled: true,
      x,
      y,
      path: 'request.headers.x-flow-tag',
      value: 'orchestrator-v3',
      next: 'end',
    }
  }

  if (kind === 'transformer') {
    return {
      id,
      kind,
      name: '转换节点',
      enabled: true,
      x,
      y,
      fromPath: 'request.prompt',
      toPath: 'request.prompt',
      mode: 'trim',
      next: 'end',
    }
  }

  if (kind === 'route-queue') {
    return {
      id,
      kind,
      name: '队列路由',
      enabled: true,
      x,
      y,
      queueId: queueOptions[1],
      next: 'end',
    }
  }

  if (kind === 'dispatch') {
    return {
      id,
      kind,
      name: '请求分发',
      enabled: true,
      x,
      y,
      mockStatus: 200,
      next: 'end',
    }
  }

  if (kind === 'response-mutate') {
    return {
      id,
      kind,
      name: '响应修改',
      enabled: true,
      x,
      y,
      path: 'response.body.tag',
      value: '{{route.targetQueue}}',
      next: 'end',
    }
  }

  return {
    id,
    kind: 'modifier',
    name: '请求修改',
    enabled: true,
    x,
    y,
    path: 'request.headers.x-flow-tag',
    value: 'orchestrator-v3',
    next: 'end',
  }
}

function WorkflowNodeCard(props: NodeProps<Node<FlowNodeData>>) {
  const node = props.data.node
  const nodeIds = props.data.nodeIds
  const connectingFrom = props.data.connectingFrom
  const removable = node.kind !== 'start' && node.kind !== 'end'
  const connectingThisNode = connectingFrom?.nodeId === node.id
  const highlightTarget = Boolean(connectingFrom) && !connectingThisNode

  const setNode = (next: WorkflowV2Node) => props.data.onChange(node.id, next)

  return (
    <div className={cn('w-64 rounded-xl bg-card px-3 py-2 text-left ring-1 ring-foreground/10', props.selected && 'ring-2 ring-primary/60', !node.enabled && 'opacity-55')}>
      {(node.kind !== 'start') && (
        <Handle type="target" id="in" position={Position.Left} className={cn('size-2! border-0! bg-muted-foreground!', highlightTarget && 'size-2.5! bg-primary!')} />
      )}

      {(node.kind !== 'end') && (
        <Handle type="source" id="next" position={Position.Right} className={cn('size-2! border-0! bg-muted-foreground!', connectingThisNode && connectingFrom?.handleId === 'next' && 'size-2.5! bg-primary!')} />
      )}

      {node.kind === 'condition' && (
        <>
          <Handle type="source" id="true" position={Position.Right} style={{ top: 28 }} className={cn('size-2! border-0! bg-success!', connectingThisNode && connectingFrom?.handleId === 'true' && 'size-2.5!')} />
          <Handle type="source" id="false" position={Position.Right} style={{ top: 64 }} className={cn('size-2! border-0! bg-warning!', connectingThisNode && connectingFrom?.handleId === 'false' && 'size-2.5!')} />
        </>
      )}

      <div className="mb-2 flex items-center gap-2">
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', kindTone(node.kind))}>{nodeKindLabel(node.kind)}</span>
        <div className="ml-auto nodrag">
          <Switch checked={node.enabled} onCheckedChange={checked => setNode({ ...node, enabled: checked })} size="sm" disabled={!removable} />
        </div>
      </div>

      <div className="nodrag space-y-1.5">
        <Input value={node.name} onChange={event => setNode({ ...node, name: event.target.value })} className="h-7 text-xs" />

        {node.kind === 'start' && (
          <Select value={node.next} onValueChange={value => setNode({ ...node, next: value })}>
            <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="next" /></SelectTrigger>
            <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
          </Select>
        )}

        {node.kind === 'context-extract' && (
          <>
            <Input value={node.sourcePath} onChange={event => setNode({ ...node, sourcePath: event.target.value })} className="h-7 text-xs" placeholder="sourcePath" />
            <Input value={node.targetPath} onChange={event => setNode({ ...node, targetPath: event.target.value })} className="h-7 text-xs" placeholder="targetPath" />
            <Select value={node.next} onValueChange={value => setNode({ ...node, next: value })}>
              <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="next" /></SelectTrigger>
              <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
          </>
        )}

        {node.kind === 'condition' && (
          <>
            <Input value={node.path} onChange={event => setNode({ ...node, path: event.target.value })} className="h-7 text-xs" placeholder="path" />
            <div className="grid grid-cols-2 gap-1.5">
              <Select value={node.operator} onValueChange={value => setNode({ ...node, operator: value as typeof node.operator })}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="operator" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">contains</SelectItem>
                  <SelectItem value="eq">eq</SelectItem>
                  <SelectItem value="gt">gt</SelectItem>
                  <SelectItem value="exists">exists</SelectItem>
                </SelectContent>
              </Select>
              <Input value={node.value} onChange={event => setNode({ ...node, value: event.target.value })} className="h-7 text-xs" placeholder="value" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Select value={node.nextTrue} onValueChange={value => setNode({ ...node, nextTrue: value })}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="true" /></SelectTrigger>
                <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={node.nextFalse} onValueChange={value => setNode({ ...node, nextFalse: value })}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="false" /></SelectTrigger>
                <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </>
        )}

        {node.kind === 'modifier' && (
          <>
            <Input value={node.path} onChange={event => setNode({ ...node, path: event.target.value })} className="h-7 text-xs" placeholder="request path" />
            <Input value={node.value} onChange={event => setNode({ ...node, value: event.target.value })} className="h-7 text-xs" placeholder="value" />
            <Select value={node.next} onValueChange={value => setNode({ ...node, next: value })}>
              <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="next" /></SelectTrigger>
              <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
          </>
        )}

        {node.kind === 'transformer' && (
          <>
            <Input value={node.fromPath} onChange={event => setNode({ ...node, fromPath: event.target.value })} className="h-7 text-xs" placeholder="fromPath" />
            <Input value={node.toPath} onChange={event => setNode({ ...node, toPath: event.target.value })} className="h-7 text-xs" placeholder="toPath" />
            <div className="grid grid-cols-2 gap-1.5">
              <Select value={node.mode} onValueChange={value => setNode({ ...node, mode: value as typeof node.mode })}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trim">trim</SelectItem>
                  <SelectItem value="uppercase">uppercase</SelectItem>
                  <SelectItem value="lowercase">lowercase</SelectItem>
                  <SelectItem value="stringify">stringify</SelectItem>
                </SelectContent>
              </Select>
              <Select value={node.next} onValueChange={value => setNode({ ...node, next: value })}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="next" /></SelectTrigger>
                <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </>
        )}

        {node.kind === 'route-queue' && (
          <>
            <Select value={node.queueId} onValueChange={value => setNode({ ...node, queueId: value })}>
              <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="queue" /></SelectTrigger>
              <SelectContent>{queueOptions.map(queue => <SelectItem key={queue} value={queue}>{queue}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={node.next} onValueChange={value => setNode({ ...node, next: value })}>
              <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="next" /></SelectTrigger>
              <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
          </>
        )}

        {node.kind === 'dispatch' && (
          <>
            <Select value={String(node.mockStatus)} onValueChange={value => setNode({ ...node, mockStatus: Number(value) })}>
              <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="202">202</SelectItem>
                <SelectItem value="429">429</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </SelectContent>
            </Select>
            <Select value={node.next} onValueChange={value => setNode({ ...node, next: value })}>
              <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="next" /></SelectTrigger>
              <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
          </>
        )}

        {node.kind === 'response-mutate' && (
          <>
            <Input value={node.path} onChange={event => setNode({ ...node, path: event.target.value })} className="h-7 text-xs" placeholder="response path" />
            <Input value={node.value} onChange={event => setNode({ ...node, value: event.target.value })} className="h-7 text-xs" placeholder="value / {{path}}" />
            <Select value={node.next} onValueChange={value => setNode({ ...node, next: value })}>
              <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="next" /></SelectTrigger>
              <SelectContent>{nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
          </>
        )}

        {node.kind === 'end' && <div className="rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">固定输出节点</div>}

        {removable && <Button type="button" variant="ghost" size="sm" onClick={() => props.data.onRemove(node.id)} className="h-7 px-2 text-xs">删除节点</Button>}
      </div>
    </div>
  )
}

function toReactFlowNodes(
  workflowNodes: WorkflowV2Node[],
  nodeIds: string[],
  connectingFrom: { nodeId: string; handleId: string | null } | null,
  onChange: (id: string, next: WorkflowV2Node) => void,
  onRemove: (id: string) => void,
): Array<Node<FlowNodeData>> {
  return workflowNodes.map(node => ({
    id: node.id,
    type: 'workflowNode',
    position: { x: node.x, y: node.y },
    draggable: node.kind !== 'start' && node.kind !== 'end',
    data: {
      node,
      nodeIds,
      connectingFrom,
      onChange,
      onRemove,
    },
  }))
}

function toReactFlowEdges(workflowNodes: WorkflowV2Node[]): Edge[] {
  const edges: Edge[] = []

  for (const node of workflowNodes) {
    if (node.kind === 'end') continue

    if (node.kind === 'condition') {
      edges.push({ id: `${node.id}-true-${node.nextTrue}`, source: node.id, sourceHandle: 'true', target: node.nextTrue, targetHandle: 'in', label: 'true' })
      edges.push({ id: `${node.id}-false-${node.nextFalse}`, source: node.id, sourceHandle: 'false', target: node.nextFalse, targetHandle: 'in', label: 'false' })
      continue
    }

    edges.push({ id: `${node.id}-next-${node.next}`, source: node.id, sourceHandle: 'next', target: node.next, targetHandle: 'in', label: 'next' })
  }

  return edges
}

function canLinkFrom(node: WorkflowV2Node): boolean {
  return node.kind !== 'end'
}

function attachNewNode(current: WorkflowV2Node[], selectedId: string | null, newNodeId: string): WorkflowV2Node[] {
  if (!selectedId) return current
  return current.map(node => {
    if (node.id !== selectedId || !canLinkFrom(node)) return node

    if (node.kind === 'condition') {
      if (node.nextTrue === 'end') return { ...node, nextTrue: newNodeId }
      if (node.nextFalse === 'end') return { ...node, nextFalse: newNodeId }
      return { ...node, nextTrue: newNodeId }
    }

    if (isLinearNode(node)) {
      return { ...node, next: newNodeId }
    }

    return node
  })
}

function WorkflowOrchestratorV2Canvas() {
  const [nodes, setNodes] = useState<WorkflowV2Node[]>(initialNodes)
  const [payloadText, setPayloadText] = useState<string>(JSON.stringify(samplePayload, null, 2))
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<V2ExecutionResult | null>(null)
  const [templateKind, setTemplateKind] = useState<V2NodeKind>('context-extract')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('start')
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; handleId: string | null } | null>(null)
  const [rf, setRf] = useState<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null)

  const nodeIds = useMemo(() => nodes.map(node => node.id), [nodes])

  const updateNode = (id: string, next: WorkflowV2Node) => {
    setNodes(current => current.map(node => (node.id === id ? next : node)))
  }

  const removeNode = (removedId: string) => {
    if (removedId === 'start' || removedId === 'end') return

    setNodes(current => current
      .filter(node => node.id !== removedId)
      .map(node => {
        if (node.kind === 'condition') {
          return {
            ...node,
            nextTrue: node.nextTrue === removedId ? 'end' : node.nextTrue,
            nextFalse: node.nextFalse === removedId ? 'end' : node.nextFalse,
          }
        }

        if (isLinearNode(node) && node.next === removedId) {
          return { ...node, next: 'end' }
        }

        return node
      }))
  }

  const reactFlowNodes = useMemo(
    () => toReactFlowNodes(nodes, nodeIds, connectingFrom, updateNode, removeNode),
    [nodes, nodeIds, connectingFrom],
  )
  const reactFlowEdges = useMemo(() => toReactFlowEdges(nodes), [nodes])

  const addNodeByKind = (kind: V2NodeKind, x?: number, y?: number) => {
    const index = nodes.length + 1
    const baseX = x ?? 360 + (index % 4) * 260
    const baseY = y ?? 260 + Math.floor(index / 4) * 110
    const nextNode = createNode(kind, baseX, baseY)

    setNodes(current => {
      const withNode = [...current, nextNode]
      return attachNewNode(withNode, selectedNodeId, nextNode.id)
    })

    setSelectedNodeId(nextNode.id)
    setMenu(null)
  }

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return

    setNodes(current => current.map(node => {
      if (node.id !== connection.source) return node

      if (node.kind === 'condition') {
        if (connection.sourceHandle === 'true') return { ...node, nextTrue: connection.target }
        if (connection.sourceHandle === 'false') return { ...node, nextFalse: connection.target }
        return node
      }

      if (isLinearNode(node)) return { ...node, next: connection.target }
      return node
    }))
  }

  const onNodesChange = (changes: NodeChange<Node<FlowNodeData>>[]) => {
    const positionChanges = changes.filter((change): change is Extract<NodeChange<Node<FlowNodeData>>, { type: 'position' }> => (
      change.type === 'position' && Boolean(change.position)
    ))

    if (positionChanges.length === 0) {
      return
    }

    setNodes(current => {
      const nextById = new Map(positionChanges.map(change => [change.id, change.position]))
      let changed = false

      const next = current.map(node => {
        const position = nextById.get(node.id)
        if (!position) {
          return node
        }
        if (node.x === position.x && node.y === position.y) {
          return node
        }
        changed = true
        return { ...node, x: position.x, y: position.y }
      })

      return changed ? next : current
    })
  }

  const runWorkflow = () => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      setRunResult(executeWorkflowV2(nodes, payload))
      setPayloadError('')
    } catch {
      setPayloadError('输入 payload 不是合法 JSON。')
    }
  }

  const nodeTypes = useMemo(() => ({ workflowNode: WorkflowNodeCard }), [])

  return (
    <PageLayout>
      <PageHeader
        title="流程编排 v2"
        description="8 节点原型：UA 分流到队列 + 请求/响应双阶段修改"
        actions={(
          <div className="flex items-center gap-2">
            <Select value={templateKind} onValueChange={value => setTemplateKind(value as V2NodeKind)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="节点类型" /></SelectTrigger>
              <SelectContent>
                {nodeTemplates.filter(item => item.kind !== 'start' && item.kind !== 'end').map(item => (
                  <SelectItem key={item.kind} value={item.kind}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="secondary" onClick={() => addNodeByKind(templateKind)}>
              <Plus className="size-4" /> 添加节点
            </Button>
            <Button type="button" variant="outline" onClick={() => { setNodes(initialNodes); setRunResult(null); setSelectedNodeId('start') }}>
              重置画布
            </Button>
            <Button type="button" onClick={runWorkflow}><CirclePlay className="size-4" /> 试跑</Button>
          </div>
        )}
      />

      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Route className="size-4" /> 编排画布</CardTitle>
            <CardDescription>固定输入/输出节点；节点内联编辑；拖线更新 next/true/false；新增节点自动连接到当前选中节点。</CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            {connectingFrom && <div className="mb-2 rounded-lg bg-muted/45 px-2.5 py-1.5 text-xs text-muted-foreground">连线中：{connectingFrom.nodeId} / {connectingFrom.handleId ?? 'next'}</div>}

            <div className="h-155 w-full overflow-hidden rounded-xl bg-muted/25" onClick={() => setMenu(null)}>
              <ReactFlow<Node<FlowNodeData>, Edge>
                nodes={reactFlowNodes}
                edges={reactFlowEdges}
                nodeTypes={nodeTypes}
                fitView
                onInit={instance => setRf(instance)}
                onNodesChange={onNodesChange}
                onConnect={onConnect}
                onConnectStart={(_event, params: OnConnectStartParams) => {
                  if (!params.nodeId) return
                  setConnectingFrom({ nodeId: params.nodeId, handleId: params.handleId ?? null })
                }}
                onConnectEnd={(_event, _state: FinalConnectionState) => setConnectingFrom(null)}
                onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
                onPaneContextMenu={event => {
                  event.preventDefault()
                  if (!rf) return
                  const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY })
                  setMenu({ x: position.x, y: position.y })
                }}
                proOptions={{ hideAttribution: true }}
              >
                <MiniMap pannable zoomable />
                <Controls showInteractive={false} />
                <Background gap={18} size={1} color="hsl(var(--muted-foreground) / 0.12)" />

                {menu && (
                  <div className="absolute z-30 w-44 rounded-lg bg-popover p-1.5 text-popover-foreground ring-1 ring-foreground/10" style={{ left: menu.x, top: menu.y }}>
                    <div className="mb-1 px-1.5 text-[11px] text-muted-foreground">添加节点</div>
                    {nodeTemplates.filter(item => item.kind !== 'start' && item.kind !== 'end').map(item => (
                      <button
                        key={item.kind}
                        type="button"
                        className="flex h-7 w-full items-center rounded-md px-1.5 text-left text-xs hover:bg-muted"
                        onClick={() => addNodeByKind(item.kind, menu.x, menu.y)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </ReactFlow>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><SquareTerminal className="size-4" /> 试跑输入</CardTitle>
              <CardDescription>本地 JSON payload，不接入后端接口。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pb-4">
              <Textarea value={payloadText} onChange={event => setPayloadText(event.target.value)} className="min-h-60 font-mono text-[12px]" />
              {payloadError && <div className="text-xs text-destructive">{payloadError}</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> 试跑结果</CardTitle>
              <CardDescription>输出目标队列、分发状态、结束原因和逐节点轨迹。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              {!runResult && <div className="rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">点击顶部“试跑”查看结果。</div>}

              {runResult && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={runResult.targetQueue ? 'success' : 'muted'}>targetQueue: {runResult.targetQueue ?? 'null'}</Badge>
                    <Badge variant={runResult.dispatched ? 'success' : 'warning'}>dispatched: {runResult.dispatched ? 'yes' : 'no'}</Badge>
                    <Badge variant="info">stop: {runResult.stoppedReason}</Badge>
                  </div>

                  <div className="rounded-lg bg-muted/45 p-2 font-mono text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Output</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.outputPayload, null, 2)}</pre>
                  </div>

                  <div className="max-h-48 space-y-1.5 overflow-auto rounded-lg bg-muted/30 p-2">
                    {runResult.trace.map(item => (
                      <div key={`${item.nodeId}-${item.message}`} className="rounded-md bg-card/70 p-2 text-xs ring-1 ring-foreground/8">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="font-medium">{item.nodeName}</span>
                          <Badge variant={item.success ? 'success' : 'warning'}>{item.kind}</Badge>
                        </div>
                        <div className="text-muted-foreground">{item.message}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </PageLayout>
  )
}

export function WorkflowOrchestratorV2Page() {
  return (
    <ReactFlowProvider>
      <WorkflowOrchestratorV2Canvas />
    </ReactFlowProvider>
  )
}
