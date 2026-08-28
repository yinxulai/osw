import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'
import { GripVertical, Plus, Play, Workflow, ArrowRight, FlaskConical } from 'lucide-react'
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
import { executeOrchestrator } from './engine'
import { initialNodes, nodeTemplates, queueOptions, samplePayload } from './fixtures'
import type {
  ConditionFalseBehavior,
  ConditionOperator,
  OrchestratorExecutionResult,
  OrchestratorNode,
  TransformMode,
} from './types'

function nodeKindLabel(kind: OrchestratorNode['kind']): string {
  if (kind === 'condition') return '条件'
  if (kind === 'modifier') return '修改'
  if (kind === 'transformer') return '转换'
  return '队列'
}

function createNodeFromTemplate(kind: OrchestratorNode['kind']): OrchestratorNode {
  const id = `node-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '新条件节点',
      enabled: true,
      config: {
        path: 'request.path',
        operator: 'contains',
        value: '/v1/',
        onFalse: 'continue',
      },
    }
  }

  if (kind === 'modifier') {
    return {
      id,
      kind,
      name: '新修改节点',
      enabled: true,
      config: {
        path: 'metadata.tag',
        value: 'prototype',
      },
    }
  }

  if (kind === 'transformer') {
    return {
      id,
      kind,
      name: '新转换节点',
      enabled: true,
      config: {
        fromPath: 'request.prompt',
        toPath: 'request.prompt',
        mode: 'trim',
      },
    }
  }

  return {
    id,
    kind,
    name: '新队列路由节点',
    enabled: true,
    config: {
      queueId: queueOptions[1],
    },
  }
}

interface NodeCardProps {
  node: OrchestratorNode
  dragging: boolean
  onChange: (next: OrchestratorNode) => void
  onRemove: () => void
  dragHandleProps: Record<string, unknown>
}

function NodeCard(props: NodeCardProps) {
  const { node, dragging, onChange, onRemove, dragHandleProps } = props

  const updateName = (name: string) => onChange({ ...node, name })
  const updateEnabled = (enabled: boolean) => onChange({ ...node, enabled })

  return (
    <div className={cn('rounded-lg bg-card/80 p-3 ring-1 ring-foreground/10', dragging && 'opacity-70')}>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          aria-label="拖拽节点"
          {...dragHandleProps}
        >
          <GripVertical className="size-4" />
        </button>
        <Badge variant="secondary">{nodeKindLabel(node.kind)}</Badge>
        <Input value={node.name} onChange={event => updateName(event.target.value)} className="h-7" />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">启用</span>
          <Switch checked={node.enabled} onCheckedChange={updateEnabled} />
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>删除</Button>
        </div>
      </div>

      {node.kind === 'condition' && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            value={node.config.path}
            onChange={event => onChange({ ...node, config: { ...node.config, path: event.target.value } })}
            placeholder="字段路径，例如 request.tenant"
          />
          <Select
            value={node.config.operator}
            onValueChange={value => onChange({ ...node, config: { ...node.config, operator: value as ConditionOperator } })}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="比较方式" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">contains</SelectItem>
              <SelectItem value="eq">eq</SelectItem>
              <SelectItem value="gt">gt</SelectItem>
              <SelectItem value="exists">exists</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={node.config.value}
            onChange={event => onChange({ ...node, config: { ...node.config, value: event.target.value } })}
            placeholder="目标值"
          />
          <Select
            value={node.config.onFalse}
            onValueChange={value => onChange({ ...node, config: { ...node.config, onFalse: value as ConditionFalseBehavior } })}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="不命中行为" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="continue">continue</SelectItem>
              <SelectItem value="stop">stop</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {node.kind === 'modifier' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={node.config.path}
            onChange={event => onChange({ ...node, config: { ...node.config, path: event.target.value } })}
            placeholder="写入路径，例如 metadata.priority"
          />
          <Input
            value={node.config.value}
            onChange={event => onChange({ ...node, config: { ...node.config, value: event.target.value } })}
          />
        </div>
      )}

      {node.kind === 'transformer' && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            value={node.config.fromPath}
            onChange={event => onChange({ ...node, config: { ...node.config, fromPath: event.target.value } })}
            placeholder="来源路径"
          />
          <Input
            value={node.config.toPath}
            onChange={event => onChange({ ...node, config: { ...node.config, toPath: event.target.value } })}
            placeholder="目标路径"
          />
          <Select
            value={node.config.mode}
            onValueChange={value => onChange({ ...node, config: { ...node.config, mode: value as TransformMode } })}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="转换方式" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="trim">trim</SelectItem>
              <SelectItem value="uppercase">uppercase</SelectItem>
              <SelectItem value="lowercase">lowercase</SelectItem>
              <SelectItem value="stringify">stringify</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {node.kind === 'route-queue' && (
        <div className="max-w-sm">
          <Select
            value={node.config.queueId}
            onValueChange={value => onChange({ ...node, config: { ...node.config, queueId: value } })}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="选择目标队列" /></SelectTrigger>
            <SelectContent>
              {queueOptions.map(queue => <SelectItem key={queue} value={queue}>{queue}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

interface SortableNodeCardProps {
  node: OrchestratorNode
  onChange: (next: OrchestratorNode) => void
  onRemove: () => void
}

function SortableNodeCard(props: SortableNodeCardProps) {
  const { node, onChange, onRemove } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <NodeCard
        node={node}
        dragging={isDragging}
        onChange={onChange}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export function WorkflowOrchestratorPage() {
  const [nodes, setNodes] = useState<OrchestratorNode[]>(initialNodes)
  const [selectedTemplate, setSelectedTemplate] = useState<OrchestratorNode['kind']>('condition')
  const [payloadText, setPayloadText] = useState(JSON.stringify(samplePayload, null, 2))
  const [executionResult, setExecutionResult] = useState<OrchestratorExecutionResult | null>(null)
  const [payloadError, setPayloadError] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const nodeIds = useMemo(() => nodes.map(node => node.id), [nodes])

  const addNode = () => setNodes(current => [...current, createNodeFromTemplate(selectedTemplate)])

  const updateNode = (id: string, next: OrchestratorNode) => {
    setNodes(current => current.map(node => (node.id === id ? next : node)))
  }

  const removeNode = (id: string) => {
    setNodes(current => current.filter(node => node.id !== id))
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setNodes(current => {
      const from = current.findIndex(node => node.id === active.id)
      const to = current.findIndex(node => node.id === over.id)
      if (from < 0 || to < 0) return current
      return arrayMove(current, from, to)
    })
  }

  const runFlow = () => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      const result = executeOrchestrator(nodes, payload)
      setExecutionResult(result)
      setPayloadError('')
    } catch {
      setPayloadError('输入负载不是合法 JSON，请先修正再运行。')
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title="流程编排原型"
        description="可拖拽节点编排：条件判断 + 修改器 + 转换器 + 队列路由（本地模拟，无外部接口）"
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => { setNodes(initialNodes); setExecutionResult(null) }}>
              重置示例
            </Button>
            <Button type="button" onClick={runFlow}><Play className="size-4" /> 运行流程</Button>
          </div>
        )}
      />

      <PageContent className="grid gap-4 xl:grid-cols-[1.35fr_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Workflow className="size-4" /> 编排画布</CardTitle>
            <CardDescription>通过拖拽调整节点顺序，执行时按从上到下依次处理。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2">
              <Select value={selectedTemplate} onValueChange={value => setSelectedTemplate(value as OrchestratorNode['kind'])}>
                <SelectTrigger className="w-48"><SelectValue placeholder="选择节点类型" /></SelectTrigger>
                <SelectContent>
                  {nodeTemplates.map(item => <SelectItem key={item.kind} value={item.kind}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" onClick={addNode}><Plus className="size-4" /> 添加节点</Button>
              <div className="text-[11px] text-muted-foreground">{nodeTemplates.find(item => item.kind === selectedTemplate)?.description}</div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={nodeIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {nodes.map(node => (
                    <SortableNodeCard
                      key={node.id}
                      node={node}
                      onChange={next => updateNode(node.id, next)}
                      onRemove={() => removeNode(node.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FlaskConical className="size-4" /> 输入负载</CardTitle>
              <CardDescription>JSON 输入仅在前端本地运行，用于验证编排逻辑。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pb-4">
              <Textarea
                value={payloadText}
                onChange={event => setPayloadText(event.target.value)}
                className="min-h-52 font-mono text-[12px]"
              />
              {payloadError && <p className="text-xs text-destructive">{payloadError}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> 执行结果</CardTitle>
              <CardDescription>展示路由目标、输出负载和每个节点执行轨迹。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              {!executionResult && (
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  点击“运行流程”查看模拟结果。
                </div>
              )}

              {executionResult && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={executionResult.targetQueue ? 'success' : 'muted'}>
                      目标队列: {executionResult.targetQueue ?? '未命中'}
                    </Badge>
                    <Badge variant={executionResult.halted ? 'warning' : 'info'}>
                      流程状态: {executionResult.halted ? '已中止' : '已完成'}
                    </Badge>
                  </div>

                  <div className="rounded-lg bg-muted/45 p-3 font-mono text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Output Payload</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(executionResult.outputPayload, null, 2)}</pre>
                  </div>

                  <div className="space-y-2">
                    {executionResult.trace.map(item => (
                      <div key={item.nodeId} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="font-medium">{item.nodeName}</span>
                          <Badge variant={item.skipped ? 'muted' : item.success ? 'success' : 'warning'}>
                            {item.skipped ? 'skipped' : item.success ? 'ok' : 'failed'}
                          </Badge>
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
