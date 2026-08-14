import { type ReactNode, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Activity,
  CheckCircle2,
  Clock3,
  GripVertical,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

type ProviderStatus = 'healthy' | 'warning' | 'cooling' | 'disabled'
type ModelStatus = 'active' | 'standby' | 'warning' | 'cooling' | 'disabled'

interface Provider {
  id: string
  name: string
  apiKeyRef: string
  baseUrl: string
  timeout: number
  enabled: boolean
  status: ProviderStatus
  latency: string
}

interface ProviderModel {
  id: string
  name: string
  upstreamModel: string
  protocol: string
  priority: number
  status: ModelStatus
  latency: string
  successRate: string
  endpointOverride?: string
}

const providers: Provider[] = [
  { id: 'prov_001', name: 'OpenAI', apiKeyRef: 'key_openai_abc123', baseUrl: 'https://api.openai.com/v1', timeout: 30000, enabled: true, status: 'healthy', latency: '1.2s' },
  { id: 'prov_002', name: 'Anthropic', apiKeyRef: 'key_anthropic_def456', baseUrl: 'https://api.anthropic.com/v1', timeout: 30000, enabled: true, status: 'healthy', latency: '2.1s' },
  { id: 'prov_003', name: 'DeepSeek', apiKeyRef: 'key_deepseek_ghi789', baseUrl: 'https://api.deepseek.com/v1', timeout: 60000, enabled: true, status: 'warning', latency: '5.8s' },
  { id: 'prov_004', name: 'Ollama (本地)', apiKeyRef: '', baseUrl: 'http://localhost:11434/v1', timeout: 120000, enabled: true, status: 'healthy', latency: '3.5s' },
]

const initialProviderModels: Record<string, ProviderModel[]> = {
  prov_001: [
    { id: 'm_001', name: '默认模型', upstreamModel: 'gpt-4o', protocol: 'openai-responses', priority: 1, status: 'active', latency: '1.2s', successRate: '99.8%' },
    { id: 'm_002', name: '代码模型', upstreamModel: 'gpt-4o', protocol: 'openai-completions', priority: 2, status: 'standby', latency: '1.2s', successRate: '99.8%', endpointOverride: 'https://api.openai.com/v1/chat/completions' },
    { id: 'm_003', name: '快速模型', upstreamModel: 'gpt-4o-mini', protocol: 'openai-completions', priority: 3, status: 'standby', latency: '0.6s', successRate: '99.9%' },
  ],
  prov_002: [
    { id: 'm_004', name: '默认模型', upstreamModel: 'claude-3-5-sonnet-20240620', protocol: 'anthropic-messages', priority: 1, status: 'standby', latency: '2.1s', successRate: '99.5%' },
    { id: 'm_005', name: '长文本模型', upstreamModel: 'claude-3-opus-20240229', protocol: 'anthropic-messages', priority: 2, status: 'standby', latency: '3.8s', successRate: '99.0%' },
  ],
  prov_003: [
    { id: 'm_006', name: '默认模型', upstreamModel: 'deepseek-chat', protocol: 'openai-completions', priority: 1, status: 'warning', latency: '5.8s', successRate: '97.2%' },
  ],
  prov_004: [
    { id: 'm_007', name: '本地模型', upstreamModel: 'qwen2.5:72b', protocol: 'openai-completions', priority: 1, status: 'standby', latency: '3.5s', successRate: '99.9%' },
  ],
}

const providerStatus: Record<ProviderStatus, { variant: 'success' | 'warning' | 'destructive' | 'muted'; label: string; dot: string }> = {
  healthy: { variant: 'success', label: '运行正常', dot: 'bg-success' },
  warning: { variant: 'warning', label: '延迟较高', dot: 'bg-warning' },
  cooling: { variant: 'destructive', label: '冷却中', dot: 'bg-destructive' },
  disabled: { variant: 'muted', label: '已禁用', dot: 'bg-muted-foreground/30' },
}

const modelStatus: Record<ModelStatus, { variant: 'info' | 'success' | 'warning' | 'destructive' | 'muted'; label: string }> = {
  active: { variant: 'info', label: '当前使用' },
  standby: { variant: 'success', label: '待命' },
  warning: { variant: 'warning', label: '延迟高' },
  cooling: { variant: 'destructive', label: '冷却中' },
  disabled: { variant: 'muted', label: '已禁用' },
}

interface SortableModelProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

function SortableModel(props: SortableModelProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative bg-card', isDragging && 'z-10 shadow-md')}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}

export default function ProvidersPage() {
  const [selectedId, setSelectedId] = useState('prov_001')
  const [providerModels, setProviderModels] = useState(initialProviderModels)
  const [searchQuery, setSearchQuery] = useState('')
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelName, setModelName] = useState('')
  const [upstreamModel, setUpstreamModel] = useState('')
  const [endpointOverride, setEndpointOverride] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const filteredProviders = providers.filter(provider =>
    provider.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )
  const selected = providers.find(provider => provider.id === selectedId)
  const models = providerModels[selectedId] || []

  const openProviderDialog = (id: string | null) => {
    setEditingProviderId(id)
    setProviderDialogOpen(true)
  }

  const openModelDialog = (model?: ProviderModel) => {
    setEditingModelId(model?.id ?? null)
    setModelName(model?.name ?? '')
    setUpstreamModel(model?.upstreamModel ?? '')
    setEndpointOverride(model?.endpointOverride ?? '')
    setModelDialogOpen(true)
  }

  const saveModel = () => {
    if (!modelName.trim() || !upstreamModel.trim()) return

    setProviderModels(current => {
      const currentModels = current[selectedId] || []
      if (editingModelId) {
        return {
          ...current,
          [selectedId]: currentModels.map(model => model.id === editingModelId
            ? { ...model, name: modelName.trim(), upstreamModel: upstreamModel.trim(), endpointOverride: endpointOverride.trim() || undefined }
            : model),
        }
      }

      const newModel: ProviderModel = {
        id: `m_${Date.now()}`,
        name: modelName.trim(),
        upstreamModel: upstreamModel.trim(),
        protocol: 'openai-completions',
        priority: currentModels.length + 1,
        status: 'standby',
        latency: '-',
        successRate: '-',
        endpointOverride: endpointOverride.trim() || undefined,
      }
      return { ...current, [selectedId]: [...currentModels, newModel] }
    })
    setModelDialogOpen(false)
  }

  const handleModelDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setProviderModels(current => {
      const currentModels = current[selectedId] || []
      const oldIndex = currentModels.findIndex(model => model.id === active.id)
      const newIndex = currentModels.findIndex(model => model.id === over.id)
      return {
        ...current,
        [selectedId]: arrayMove(currentModels, oldIndex, newIndex).map((model, index) => ({
          ...model,
          priority: index + 1,
        })),
      }
    })
  }

  return (
    <PageLayout>
      <PageHeader
        title="模型管理"
        description="集中管理供应商连接与上游模型映射"
        actions={(
          <Button size="sm" className="h-8 text-xs" onClick={() => openProviderDialog(null)}>
            <Plus size={14} /> 新建供应商
          </Button>
        )}
      />
      <PageContent>
        <Card>
          <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between sm:space-y-0">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>供应商</CardTitle>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">{providers.length} 个</Badge>
              </div>
              <CardDescription className="mt-1">选择供应商以查看连接配置和可用模型</CardDescription>
            </div>
            <div className="relative w-full sm:w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索供应商"
                placeholder="搜索供应商"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </CardHeader>
          <CardContent>
            {filteredProviders.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
                {filteredProviders.map(provider => {
                  const count = providerModels[provider.id]?.length || 0
                  const isSelected = selectedId === provider.id
                  return (
                    <button
                      key={provider.id}
                      onClick={() => setSelectedId(provider.id)}
                      className={cn(
                        'min-w-0 rounded-sm border px-3 py-2.5 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/4 ring-1 ring-primary/10'
                          : 'bg-background hover:bg-muted/50',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', providerStatus[provider.status].dot)} />
                        <span className="truncate text-xs font-semibold">{provider.name}</span>
                      </span>
                      <span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span>{count} 个模型</span>
                        <span className="tabular-nums">{provider.latency}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground">没有匹配的供应商</div>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <>
            <Card>
              <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Server size={17} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{selected.name}</CardTitle>
                      <Badge variant={providerStatus[selected.status].variant} className="h-5 px-1.5 text-[10px]">
                        {providerStatus[selected.status].label}
                      </Badge>
                    </div>
                    <CardDescription className="mt-1">连接配置由该供应商下的模型默认继承</CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8 text-xs">
                    <Activity size={13} /> 测试连接
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openProviderDialog(selected.id)}>
                    <Pencil size={13} /> 编辑配置
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 overflow-hidden rounded-md border lg:grid-cols-[minmax(240px,2fr)_1fr_1fr_1fr]">
                  <div className="col-span-2 min-w-0 border-b p-3 lg:col-span-1 lg:border-b-0 lg:border-r">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      <Link2 size={11} /> 基础地址
                    </div>
                    <div className="truncate font-mono text-[11px]" title={selected.baseUrl}>{selected.baseUrl}</div>
                  </div>
                  <div className="border-r p-3 lg:border-r">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      <KeyRound size={11} /> API Key
                    </div>
                    <div className="text-[11px]">{selected.apiKeyRef ? '已安全配置' : '无需认证'}</div>
                  </div>
                  <div className="p-3 lg:border-r">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      <Clock3 size={11} /> 请求超时
                    </div>
                    <div className="text-[11px] tabular-nums">{selected.timeout / 1000} 秒</div>
                  </div>
                  <div className="col-span-2 border-t p-3 lg:col-span-1 lg:border-t-0">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      <CheckCircle2 size={11} /> 当前延迟
                    </div>
                    <div className="text-[11px] tabular-nums">{selected.latency}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle>上游模型</CardTitle>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">{models.length} 个</Badge>
                  </div>
                  <CardDescription className="mt-1">拖拽调整顺序，模型可使用完整接口地址覆盖供应商配置</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={() => openModelDialog()}>
                  <Plus size={13} /> 添加模型
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                {models.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                    onDragEnd={handleModelDragEnd}
                  >
                    <SortableContext items={models.map(model => model.id)} strategy={verticalListSortingStrategy}>
                      <div className="-mx-4 divide-y border-t">
                        {models.map(model => {
                          const effectiveEndpoint = model.endpointOverride || selected.baseUrl
                          return (
                            <SortableModel key={model.id} id={model.id}>
                              {(handleProps, dragging) => (
                                <div
                                  className={cn(
                                    'flex items-start gap-2 border-l-2 border-l-transparent px-4 py-3 transition-colors hover:bg-muted/20',
                                    model.status === 'active' && 'border-l-primary bg-primary/3',
                                    model.status === 'cooling' && 'opacity-60',
                                    dragging && 'bg-muted/60',
                                  )}
                                >
                                  <button
                                    type="button"
                                    aria-label={`拖动 ${model.name} 调整优先级`}
                                    className="mt-1 shrink-0 cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground active:cursor-grabbing"
                                    {...handleProps}
                                  >
                                    <GripVertical size={14} />
                                  </button>
                                  <div className={cn(
                                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold',
                                    model.status === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                                  )}>
                                    {model.priority}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                                      <div className="min-w-32 flex-1">
                                        <div className="truncate text-xs font-semibold">{model.name}</div>
                                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{model.upstreamModel}</div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <Badge variant={modelStatus[model.status].variant} className="h-5 px-1.5 text-[10px]">
                                          {modelStatus[model.status].label}
                                        </Badge>
                                        <div className="flex items-center">
                                          <Button variant="ghost" size="icon" className="h-7 w-7" title="编辑模型" onClick={() => openModelDialog(model)}><Pencil size={13} /></Button>
                                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="删除模型"><Trash2 size={13} /></Button>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                                      <div className="min-w-0 rounded-sm bg-muted/50 px-2.5 py-1.5">
                                        <div className="flex items-center gap-2">
                                          <span className="shrink-0 text-[10px] font-medium text-muted-foreground">接口地址</span>
                                          <span className={cn(
                                            'shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-medium',
                                            model.endpointOverride ? 'bg-info/10 text-info' : 'bg-background text-muted-foreground',
                                          )}>
                                            {model.endpointOverride ? '模型覆盖' : '继承供应商'}
                                          </span>
                                        </div>
                                        <div className="mt-1 truncate font-mono text-[10px]" title={effectiveEndpoint}>{effectiveEndpoint}</div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                        <span>协议 <strong className="font-medium text-foreground">{model.protocol}</strong></span>
                                        <span>延迟 <strong className="font-medium tabular-nums text-foreground">{model.latency}</strong></span>
                                        <span>成功率 <strong className="font-medium tabular-nums text-foreground">{model.successRate}</strong></span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </SortableModel>
                          )
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="flex min-h-44 flex-col items-center justify-center border-t text-center">
                    <Link2 size={22} className="mb-2 text-muted-foreground/40" />
                    <p className="text-xs font-medium">还没有上游模型</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">添加模型后即可加入代理队列</p>
                    <Button size="sm" className="mt-3 h-8 text-xs" onClick={() => openModelDialog()}><Plus size={13} /> 添加模型</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="flex min-h-40 items-center justify-center text-xs text-muted-foreground">请选择一个供应商</Card>
        )}
      </PageContent>

      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProviderId ? '编辑供应商配置' : '新建供应商'}</DialogTitle>
            <DialogDescription>配置供应商级连接信息，所属模型默认继承此配置。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="provider-name">供应商名称</Label>
              <Input id="provider-name" defaultValue={editingProviderId ? selected?.name : ''} placeholder="例如：OpenAI" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-url">基础地址</Label>
              <Input id="provider-url" className="font-mono text-xs" defaultValue={editingProviderId ? selected?.baseUrl : ''} placeholder="https://api.example.com/v1" />
              <p className="text-[11px] text-muted-foreground">作为该供应商下所有模型的默认请求地址。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-key">API Key</Label>
              <Input id="provider-key" type="password" defaultValue={editingProviderId ? '••••••••••••' : ''} placeholder="sk-..." />
              <p className="text-[11px] text-muted-foreground">凭据安全存储在系统钥匙串中。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-timeout">请求超时（毫秒）</Label>
              <Input id="provider-timeout" type="number" defaultValue={editingProviderId ? selected?.timeout : 30000} placeholder="例如：30000" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProviderDialogOpen(false)}>取消</Button>
            <Button onClick={() => setProviderDialogOpen(false)}>{editingProviderId ? '保存修改' : '创建供应商'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingModelId ? '编辑上游模型' : '添加上游模型'}</DialogTitle>
            <DialogDescription>配置模型映射，并可用完整接口地址覆盖供应商基础地址。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="model-name">显示名称</Label>
                <Input id="model-name" value={modelName} onChange={event => setModelName(event.target.value)} placeholder="例如：代码模型" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upstream-model">上游模型 ID</Label>
                <Input id="upstream-model" className="font-mono text-xs" value={upstreamModel} onChange={event => setUpstreamModel(event.target.value)} placeholder="gpt-4o" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="model-endpoint">完整接口地址（可选）</Label>
                {endpointOverride && (
                  <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setEndpointOverride('')}>恢复继承</button>
                )}
              </div>
              <Input
                id="model-endpoint"
                type="url"
                className="font-mono text-xs"
                value={endpointOverride}
                onChange={event => setEndpointOverride(event.target.value)}
                placeholder={`${selected?.baseUrl ?? 'https://api.example.com/v1'}/chat/completions`}
              />
              <div className="rounded-sm border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                {endpointOverride ? (
                  <>模型请求将直接发送到 <span className="break-all font-mono text-foreground">{endpointOverride}</span></>
                ) : (
                  <>当前继承供应商地址 <span className="break-all font-mono text-foreground">{selected?.baseUrl}</span></>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModelDialogOpen(false)}>取消</Button>
            <Button disabled={!modelName.trim() || !upstreamModel.trim()} onClick={saveModel}>{editingModelId ? '保存修改' : '添加模型'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}
