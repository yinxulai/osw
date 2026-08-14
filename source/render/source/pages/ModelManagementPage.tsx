import { type ReactNode, useEffect, useState } from 'react'
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
import { GripVertical, KeyRound, Link2, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import type { LogicalModel, UpstreamModel, Protocol, ProtocolEndpoint, Provider, ProviderHealth } from '@common/schemas'
import { upstreamModelApi, healthApi, logicalModelApi, providerApi } from '@/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

interface BindingEntry {
  protocol: Protocol
  enabled: boolean
  overrideUrl: boolean
  upstreamUrl: string
}

interface ProviderEndpointEntry {
  protocol: Protocol
  enabled: boolean
  url: string
}

type ProviderEndpoints = Partial<Record<Protocol, string>>

function parseProviderEndpoints(provider?: Provider): ProviderEndpoints {
  if (!provider) return {}
  try {
    const parsed = JSON.parse(provider.upstreamUrls ?? '{}') as Record<string, string>
    return {
      'openai-completions': parsed['openai-completions'] ?? '',
      'openai-responses': parsed['openai-responses'] ?? '',
      'anthropic-messages': parsed['anthropic-messages'] ?? '',
    }
  } catch {
    return {}
  }
}

function getEffectiveEndpointUrl(endpoint: ProtocolEndpoint, provider?: Provider): string {
  if (endpoint.upstreamUrl.trim()) return endpoint.upstreamUrl
  if (!provider) return ''
  return parseProviderEndpoints(provider)[endpoint.protocol] ?? ''
}

const PROTOCOL_OPTIONS: { value: Protocol; label: string }[] = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
]

const PROTOCOL_DESCRIPTIONS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI 兼容的 /chat/completions 接口，适用于 OpenAI、DeepSeek、Ollama 等。',
  'openai-responses': 'OpenAI 新一代 /responses 接口，适用于 OpenAI 官方模型。',
  'anthropic-messages': 'Anthropic Claude 的 /messages 接口。',
}

const PROTOCOL_PLACEHOLDERS: Record<Protocol, string> = {
  'openai-completions': 'https://api.openai.com/v1/chat/completions',
  'openai-responses': 'https://api.openai.com/v1/responses',
  'anthropic-messages': 'https://api.anthropic.com/v1/messages',
}

const PROTOCOL_EXAMPLES: Record<Protocol, { provider: string; url: string }[]> = {
  'openai-completions': [
    { provider: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions' },
    { provider: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions' },
    { provider: 'Ollama（本地）', url: 'http://localhost:11434/v1/chat/completions' },
  ],
  'openai-responses': [
    { provider: 'OpenAI', url: 'https://api.openai.com/v1/responses' },
  ],
  'anthropic-messages': [
    { provider: 'Anthropic', url: 'https://api.anthropic.com/v1/messages' },
  ],
}

type ProtocolUrlHintProps = { protocol: Protocol }

function ProtocolUrlHint(props: ProtocolUrlHintProps) {
  const { protocol } = props
  const examples = PROTOCOL_EXAMPLES[protocol]
  return (
    <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">
        完整接口地址需包含协议、主机、路径，指向该模型真实的 <span className="font-mono text-[10px]">{protocol}</span> 端点。
      </p>
      <div className="mt-1.5 space-y-0.5">
        {examples.map(example => (
          <div key={example.url} className="flex items-center gap-1.5 text-[10px]">
            <span className="shrink-0 text-muted-foreground">{example.provider}：</span>
            <code className="truncate text-muted-foreground/80">{example.url}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

interface SortableBindingProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

function SortableBinding(props: SortableBindingProps) {
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

function getProviderState(provider: Provider, health?: ProviderHealth) {
  if (!provider.enabled) return { label: '已禁用', variant: 'muted' as const, dot: 'bg-muted-foreground/30' }
  if (health?.cooldownUntilTime && health.cooldownUntilTime > Date.now()) {
    return { label: '冷却中', variant: 'destructive' as const, dot: 'bg-destructive' }
  }
  if (health?.consecutiveFailures) return { label: '连接异常', variant: 'warning' as const, dot: 'bg-warning' }
  return { label: '可用', variant: 'success' as const, dot: 'bg-success' }
}

export default function ModelManagementPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [logicalModel, setLogicalModel] = useState<LogicalModel | null>(null)
  const [models, setModels] = useState<UpstreamModel[]>([])
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({})
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [providerName, setProviderName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [timeout, setTimeout] = useState('30000')
  const [providerEndpointEntries, setProviderEndpointEntries] = useState<ProviderEndpointEntry[]>([])
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<UpstreamModel | null>(null)
  const [modelId, setModelId] = useState('')
  const [bindingEntries, setBindingEntries] = useState<BindingEntry[]>([])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const loadData = async () => {
    setLoading(true)
    setErrorMessage('')
    const [providerResult, modelResult, healthResult] = await Promise.all([
      providerApi.list(),
      logicalModelApi.list(),
      healthApi.list(),
    ])
    if (!providerResult.success || !modelResult.success || !healthResult.success) {
      setErrorMessage(
        !providerResult.success ? providerResult.errorMessage
          : !modelResult.success ? modelResult.errorMessage
            : !healthResult.success ? healthResult.errorMessage : '加载失败',
      )
      setLoading(false)
      return
    }

    let currentModel = modelResult.data.find(model => model.enabled) ?? modelResult.data[0]
    if (!currentModel) {
      const result = await logicalModelApi.create({ name: 'default', description: '默认代理模型' })
      if (!result.success) {
        setErrorMessage(result.errorMessage)
        setLoading(false)
        return
      }
      currentModel = result.data
    }

    const modelListResult = await upstreamModelApi.list(currentModel.id)
    if (!modelListResult.success) {
      setErrorMessage(modelListResult.errorMessage)
      setLoading(false)
      return
    }
    setProviders(providerResult.data)
    setLogicalModel(currentModel)
    setModels(modelListResult.data)
    setHealth(Object.fromEntries(healthResult.data.map(item => [item.providerId, item])))
    setSelectedProviderId(current => providerResult.data.some(provider => provider.id === current)
      ? current
      : providerResult.data[0]?.id ?? '')
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const selectedProvider = providers.find(provider => provider.id === selectedProviderId)
  const selectedModels = models
    .filter(model => model.providerId === selectedProviderId)
    .sort((a, b) => a.priority - b.priority)

  const openProviderDialog = (provider?: Provider) => {
    setEditingProviderId(provider?.id ?? null)
    setProviderName(provider?.name ?? '')
    setApiKey('')
    setTimeout(String(provider?.timeoutMilliseconds ?? 30000))
    setProviderEndpointEntries(
      PROTOCOL_OPTIONS.map(option => {
        const url = parseProviderEndpoints(provider)[option.value] ?? ''
        return { protocol: option.value, enabled: Boolean(url), url }
      }),
    )
    setProviderDialogOpen(true)
  }

  const updateProviderEndpointEntry = (index: number, patch: Partial<ProviderEndpointEntry>) => {
    setProviderEndpointEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  const saveProvider = async () => {
    if (!providerName.trim() || (!editingProviderId && !apiKey.trim())) return
    setSaving(true)
    const endpoints: Record<string, string> = Object.fromEntries(
      providerEndpointEntries
        .filter(entry => entry.enabled)
        .map(entry => [entry.protocol, entry.url.trim()])
        .filter(([, value]) => value),
    )
    const result = editingProviderId
      ? await providerApi.update(editingProviderId, {
          name: providerName.trim(),
          timeoutMilliseconds: Number(timeout),
          endpoints,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
      : await providerApi.create({
          name: providerName.trim(),
          apiKey: apiKey.trim(),
          timeoutMilliseconds: Number(timeout),
          endpoints,
        })
    setSaving(false)
    if (!result.success) return setErrorMessage(result.errorMessage)
    setProviderDialogOpen(false)
    setSelectedProviderId(result.data.id)
    await loadData()
  }

  const removeProvider = async (provider: Provider) => {
    if (!window.confirm(`删除供应商“${provider.name}”？关联模型将被禁用。`)) return
    const result = await providerApi.remove(provider.id)
    if (!result.success) return setErrorMessage(result.errorMessage)
    await loadData()
  }

  const openModelDialog = (model?: UpstreamModel) => {
    setEditingModel(model ?? null)
    setModelId(model?.upstreamModelId ?? '')
    setBindingEntries(PROTOCOL_OPTIONS.map(option => {
      const match = model?.endpoints.find(endpoint => endpoint.protocol === option.value)
      return match
        ? { protocol: option.value, enabled: true, overrideUrl: Boolean(match.upstreamUrl.trim()), upstreamUrl: match.upstreamUrl }
        : { protocol: option.value, enabled: false, overrideUrl: false, upstreamUrl: '' }
    }))
    setModelDialogOpen(true)
  }

  const updateBindingEntry = (index: number, patch: Partial<BindingEntry>) => {
    setBindingEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  const saveModel = async () => {
    if (!logicalModel || !selectedProvider) return
    if (!modelId.trim()) return
    const enabledEntries = bindingEntries.filter(entry => entry.enabled)
    if (enabledEntries.length === 0) return
    setSaving(true)

    const endpoints: ProtocolEndpoint[] = enabledEntries.map(entry => ({
      protocol: entry.protocol,
      upstreamUrl: entry.overrideUrl ? entry.upstreamUrl.trim() : '',
      customAuthHeader: null,
    }))

    const basePriority = editingModel
      ? editingModel.priority
      : models.length === 0
        ? 1
        : Math.max(...models.map(model => model.priority)) + 1

    const result = editingModel
      ? await upstreamModelApi.update(editingModel.id, {
          upstreamModelId: modelId.trim(),
          endpoints,
        })
      : await upstreamModelApi.create({
          logicalModelId: logicalModel.id,
          providerId: selectedProvider.id,
          upstreamModelId: modelId.trim(),
          endpoints,
          priority: basePriority,
        })

    setSaving(false)
    if (!result.success) {
      setErrorMessage(result.errorMessage)
      await loadData()
      return
    }
    setModelDialogOpen(false)
    await loadData()
  }

  const removeModel = async (model: UpstreamModel) => {
    if (!window.confirm(`删除模型“${model.upstreamModelId}”？该模型关联的所有协议接口都会被移除。`)) return
    const result = await upstreamModelApi.remove(model.id)
    if (!result.success) return setErrorMessage(result.errorMessage)
    await loadData()
  }

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = selectedModels.findIndex(model => model.id === active.id)
    const newIndex = selectedModels.findIndex(model => model.id === over.id)
    const reordered = arrayMove(selectedModels, oldIndex, newIndex)
    const updates: { id: string; priority: number }[] = reordered.map((model, index) => ({
      id: model.id,
      priority: index + 1,
    }))
    setModels(current => current.map(model => {
      const update = updates.find(item => item.id === model.id)
      return update ? { ...model, priority: update.priority } : model
    }).sort((left, right) => left.priority - right.priority))
    const results = await Promise.all(updates.map(update => upstreamModelApi.update(update.id, { priority: update.priority })))
    if (results.some(result => !result.success)) {
      setErrorMessage('模型顺序保存失败，已恢复服务端数据')
      await loadData()
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title="模型管理"
        description="集中管理供应商凭据与上游模型映射"
        actions={<Button size="sm" className="h-8 text-xs" onClick={() => openProviderDialog()}><Plus size={14} /> 新建供应商</Button>}
      />
      <PageContent>
        {errorMessage && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{errorMessage}</div>}
        {loading ? (
          <Card className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">正在加载模型配置...</Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>供应商</CardTitle>
                <CardDescription>密钥按供应商保存，可为每个协议配置默认接口地址，模型可单独覆盖。</CardDescription>
              </CardHeader>
              <CardContent>
                {providers.length ? (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
                    {providers.map(provider => {
                      const state = getProviderState(provider, health[provider.id])
                      return (
                        <button
                          key={provider.id}
                          onClick={() => setSelectedProviderId(provider.id)}
                          className={cn('min-w-0 rounded-sm border px-3 py-2.5 text-left transition-colors', selectedProviderId === provider.id ? 'border-primary bg-primary/5 ring-1 ring-primary/10' : 'hover:bg-muted/50')}
                        >
                          <span className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', state.dot)} /><span className="truncate text-xs font-semibold">{provider.name}</span></span>
                          <span className="mt-1.5 block text-[10px] text-muted-foreground">
                            {new Set(models.filter(model => model.providerId === provider.id).map(model => model.upstreamModelId)).size} 个模型
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : <div className="py-10 text-center text-xs text-muted-foreground">还没有供应商，请先创建一个。</div>}
              </CardContent>
            </Card>

            {selectedProvider && (
              <Card>
                <CardHeader className="gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary"><Server size={17} /></div>
                    <div>
                      <div className="flex items-center gap-2"><CardTitle>{selectedProvider.name}</CardTitle><Badge variant={getProviderState(selectedProvider, health[selectedProvider.id]).variant}>{getProviderState(selectedProvider, health[selectedProvider.id]).label}</Badge></div>
                      <CardDescription className="mt-1">超时 {selectedProvider.timeoutMilliseconds / 1000} 秒 · 密钥已安全配置</CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openProviderDialog(selectedProvider)}><Pencil size={13} /> 编辑</Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="删除供应商" onClick={() => void removeProvider(selectedProvider)}><Trash2 size={13} /></Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mb-2 flex items-center justify-between border-t pt-3">
                    <div><div className="text-xs font-semibold">上游模型</div><div className="mt-0.5 text-[11px] text-muted-foreground">每个模型一行，可同时支持多个协议；拖拽调整全局队列中的相对优先级</div></div>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openModelDialog()}><Plus size={13} /> 添加模型</Button>
                  </div>
                  {selectedModels.length ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={event => void handleDragEnd(event)}>
                      <SortableContext items={selectedModels.map(model => model.id)} strategy={verticalListSortingStrategy}>
                        <div className="divide-y rounded-md border">
                          {selectedModels.map(model => (
                            <SortableBinding key={model.id} id={model.id}>
                              {(handleProps, dragging) => (
                                <div className={cn('flex items-center gap-2 px-3 py-2.5', dragging && 'bg-muted/60')}>
                                  <button aria-label={`拖动 ${model.upstreamModelId}`} className="cursor-grab touch-none text-muted-foreground/50" {...handleProps}><GripVertical size={14} /></button>
                                  <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">{model.priority}</div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="truncate text-xs font-semibold">{model.upstreamModelId}</span>
                                      <span className="flex flex-wrap gap-1">
                                        {model.endpoints.map(endpoint => (
                                          <Badge key={endpoint.protocol} variant="secondary" className="h-5 px-1.5 text-[9px]">
                                            {endpoint.protocol.toUpperCase()}
                                            {!endpoint.upstreamUrl.trim() && <span className="ml-1 text-muted-foreground/70">默认</span>}
                                          </Badge>
                                        ))}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground">
                                      <Link2 size={10} /> {model.endpoints.map(endpoint => getEffectiveEndpointUrl(endpoint, selectedProvider)).filter(Boolean).join(' / ') || '未配置地址'}
                                    </div>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="编辑模型" onClick={() => openModelDialog(model)}><Pencil size={13} /></Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="删除模型" onClick={() => void removeModel(model)}><Trash2 size={13} /></Button>
                                </div>
                              )}
                            </SortableBinding>
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  ) : <div className="flex min-h-36 flex-col items-center justify-center rounded-md border text-center"><Link2 size={20} className="mb-2 text-muted-foreground/40" /><p className="text-xs font-medium">还没有上游模型</p><p className="mt-1 text-[11px] text-muted-foreground">添加后即可通过本地代理调用</p></div>}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageContent>

      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editingProviderId ? '编辑供应商' : '新建供应商'}</DialogTitle><DialogDescription>供应商保存各自的 API Key 与请求参数，供上游模型共用。</DialogDescription></DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1 py-2">
            {/* 基础信息 */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="provider-name">供应商名称</Label>
                  <Input id="provider-name" value={providerName} onChange={event => setProviderName(event.target.value)} placeholder="例如：OpenAI / DeepSeek" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-key">API Key</Label>
                  <div className="relative">
                    <KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input id="provider-key" type="password" className="pl-8" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={editingProviderId ? '留空表示不修改' : 'sk-...'} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">仅保存在本机，用于调用该供应商的上游接口。</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-timeout">请求超时（毫秒）</Label>
                  <Input id="provider-timeout" type="number" min={1} value={timeout} onChange={event => setTimeout(event.target.value)} placeholder="例如：30000" />
                  <p className="text-[11px] text-muted-foreground">超时后自动切换下一个候选模型，默认 30 秒（30000 毫秒）。</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* 协议默认地址 */}
            <div className="space-y-3">
              <div>
                <Label className="text-sm">支持的协议默认接口地址</Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">开启某个协议并填入默认地址；添加模型选择该协议时如不覆盖则沿用此地址。</p>
              </div>
              {providerEndpointEntries.map((entry, index) => (
                <div key={entry.protocol} className={cn('space-y-3 rounded-md border p-3 transition-colors', !entry.enabled && 'opacity-60')}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{PROTOCOL_OPTIONS.find(o => o.value === entry.protocol)?.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">{entry.enabled ? '已配置' : '未配置'}</span>
                      <Switch checked={entry.enabled} onCheckedChange={checked => updateProviderEndpointEntry(index, { enabled: checked })} />
                    </div>
                  </div>
                  {entry.enabled && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`provider-endpoint-url-${index}`}>完整接口地址</Label>
                        <Input id={`provider-endpoint-url-${index}`} type="url" className="font-mono text-xs" value={entry.url} onChange={event => updateProviderEndpointEntry(index, { url: event.target.value })} placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]} />
                      </div>
                      <p className="text-[11px] text-muted-foreground">{PROTOCOL_DESCRIPTIONS[entry.protocol]}</p>
                      <ProtocolUrlHint protocol={entry.protocol} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setProviderDialogOpen(false)}>取消</Button><Button disabled={saving || !providerName.trim() || (!editingProviderId && !apiKey.trim())} onClick={() => void saveProvider()}>{saving ? '保存中...' : editingProviderId ? '保存修改' : '创建供应商'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editingModel ? '编辑上游模型' : '添加上游模型'}</DialogTitle><DialogDescription>填写上游模型 ID，并选择该模型支持的协议接口；不同协议可使用不同地址。</DialogDescription></DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-1 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="model-id">上游模型 ID</Label>
              <Input id="model-id" className="font-mono text-xs" value={modelId} onChange={event => setModelId(event.target.value)} placeholder="gpt-4o" />
              <p className="text-[11px] text-muted-foreground">该供应商下的实际模型名，发起请求时代理会按此 ID 调用。</p>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-sm">支持的协议接口</Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">开启表示该模型支持此协议；可单独覆盖供应商在该协议下的默认地址。</p>
              </div>
              {bindingEntries.map((entry, index) => (
                <div key={entry.protocol} className={cn('space-y-3 rounded-md border p-3 transition-colors', !entry.enabled && 'opacity-60')}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{PROTOCOL_OPTIONS.find(o => o.value === entry.protocol)?.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">{entry.enabled ? '已启用' : '未启用'}</span>
                      <Switch checked={entry.enabled} onCheckedChange={checked => updateBindingEntry(index, { enabled: checked })} />
                    </div>
                  </div>
                  {entry.enabled && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`binding-override-${index}`}>覆盖供应商默认地址</Label>
                        <Switch checked={entry.overrideUrl} onCheckedChange={checked => updateBindingEntry(index, { overrideUrl: checked, upstreamUrl: checked ? entry.upstreamUrl : '' })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`binding-url-${index}`}>完整接口地址</Label>
                        <Input id={`binding-url-${index}`} type="url" className="font-mono text-xs" value={entry.upstreamUrl} onChange={event => updateBindingEntry(index, { upstreamUrl: event.target.value })} placeholder={entry.overrideUrl ? PROTOCOL_PLACEHOLDERS[entry.protocol] : '使用供应商默认地址'} disabled={!entry.overrideUrl} />
                      </div>
                      <ProtocolUrlHint protocol={entry.protocol} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setModelDialogOpen(false)}>取消</Button><Button disabled={saving || !modelId.trim() || !bindingEntries.some(entry => entry.enabled)} onClick={() => void saveModel()}>{saving ? '保存中...' : editingModel ? '保存修改' : '添加模型'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}
