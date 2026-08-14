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
import type { LogicalModel, ModelBinding, Protocol, Provider, ProviderHealth } from '@common/schemas'
import { bindingApi, healthApi, logicalModelApi, providerApi } from '@/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

interface BindingEntry {
  protocol: Protocol
  upstreamUrl: string
  upstreamModelId: string
}

interface ProviderEndpointEntry {
  protocol: Protocol
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

function getEffectiveBindingUrl(binding: ModelBinding, provider?: Provider): string {
  if (binding.upstreamUrl.trim()) return binding.upstreamUrl
  if (!provider) return ''
  return parseProviderEndpoints(provider)[binding.protocol] ?? ''
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
  const [bindings, setBindings] = useState<ModelBinding[]>([])
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
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false)
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null)
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

    const bindingResult = await bindingApi.list(currentModel.id)
    if (!bindingResult.success) {
      setErrorMessage(bindingResult.errorMessage)
      setLoading(false)
      return
    }
    setProviders(providerResult.data)
    setLogicalModel(currentModel)
    setBindings(bindingResult.data)
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
  const selectedBindings = bindings.filter(binding => binding.providerId === selectedProviderId)

  const openProviderDialog = (provider?: Provider) => {
    setEditingProviderId(provider?.id ?? null)
    setProviderName(provider?.name ?? '')
    setApiKey('')
    setTimeout(String(provider?.timeoutMilliseconds ?? 30000))
    setProviderEndpointEntries(
      PROTOCOL_OPTIONS
        .map(option => ({ protocol: option.value, url: parseProviderEndpoints(provider)[option.value] ?? '' }))
        .filter(entry => entry.url),
    )
    setProviderDialogOpen(true)
  }

  const addProviderEndpointEntry = () => {
    setProviderEndpointEntries(current => {
      const usedProtocols = new Set(current.map(entry => entry.protocol))
      const nextProtocol = PROTOCOL_OPTIONS.find(option => !usedProtocols.has(option.value))?.value ?? 'openai-responses'
      return [...current, { protocol: nextProtocol, url: '' }]
    })
  }

  const updateProviderEndpointEntry = (index: number, patch: Partial<ProviderEndpointEntry>) => {
    setProviderEndpointEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  const removeProviderEndpointEntry = (index: number) => {
    setProviderEndpointEntries(current => current.filter((_, i) => i !== index))
  }

  const saveProvider = async () => {
    if (!providerName.trim() || (!editingProviderId && !apiKey.trim())) return
    setSaving(true)
    const endpoints: Record<string, string> = Object.fromEntries(
      providerEndpointEntries
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

  const openBindingDialog = (binding?: ModelBinding) => {
    setEditingBindingId(binding?.id ?? null)
    setBindingEntries(binding
      ? [{ protocol: binding.protocol, upstreamModelId: binding.upstreamModelId, upstreamUrl: binding.upstreamUrl }]
      : [{ protocol: 'openai-responses', upstreamModelId: '', upstreamUrl: '' }])
    setBindingDialogOpen(true)
  }

  const updateBindingEntry = (index: number, patch: Partial<BindingEntry>) => {
    setBindingEntries(current => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  const addBindingEntry = () => {
    setBindingEntries(current => {
      const usedProtocols = new Set(current.map(entry => entry.protocol))
      const nextProtocol = PROTOCOL_OPTIONS.find(option => !usedProtocols.has(option.value))?.value ?? 'openai-responses'
      return [...current, { protocol: nextProtocol, upstreamModelId: '', upstreamUrl: '' }]
    })
  }

  const removeBindingEntry = (index: number) => {
    setBindingEntries(current => current.filter((_, i) => i !== index))
  }

  const usedProtocols = bindingEntries.map(entry => entry.protocol)

  const updateBindingEntryProtocol = (index: number, protocol: Protocol) => {
    setBindingEntries(current => {
      const occupiedIndex = current.findIndex((entry, i) => i !== index && entry.protocol === protocol)
      if (occupiedIndex < 0) {
        return current.map((entry, i) => (i === index ? { ...entry, protocol } : entry))
      }
      // 目标协议已被其他条目占用：交换两者协议
      return current.map((entry, i) => {
        if (i === index) {
          return { ...entry, protocol: current[occupiedIndex].protocol }
        }
        if (i === occupiedIndex) {
          return { ...entry, protocol: current[index].protocol }
        }
        return entry
      })
    })
  }

  const saveBinding = async () => {
    if (!logicalModel || !selectedProvider) return
    const validEntries = bindingEntries.filter(entry => entry.upstreamModelId.trim())
    if (validEntries.length === 0) return
    setSaving(true)

    if (editingBindingId) {
      const entry = validEntries[0]
      const result = await bindingApi.update(editingBindingId, {
        protocol: entry.protocol,
        upstreamModelId: entry.upstreamModelId.trim(),
        upstreamUrl: entry.upstreamUrl.trim(),
      })
      setSaving(false)
      if (!result.success) return setErrorMessage(result.errorMessage)
      setBindingDialogOpen(false)
      await loadData()
      return
    }

    const results = await Promise.all(validEntries.map((entry, index) =>
      bindingApi.create({
        logicalModelId: logicalModel.id,
        providerId: selectedProvider.id,
        protocol: entry.protocol,
        upstreamModelId: entry.upstreamModelId.trim(),
        upstreamUrl: entry.upstreamUrl.trim(),
        priority: bindings.length + index + 1,
      }),
    ))
    setSaving(false)
    if (results.some(result => !result.success)) {
      setErrorMessage('部分模型保存失败，请检查地址与协议后重试')
      await loadData()
      return
    }
    setBindingDialogOpen(false)
    await loadData()
  }

  const removeBinding = async (binding: ModelBinding) => {
    if (!window.confirm(`删除上游模型“${binding.upstreamModelId}”？`)) return
    const result = await bindingApi.remove(binding.id)
    if (!result.success) return setErrorMessage(result.errorMessage)
    await loadData()
  }

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = selectedBindings.findIndex(binding => binding.id === active.id)
    const newIndex = selectedBindings.findIndex(binding => binding.id === over.id)
    const reordered = arrayMove(selectedBindings, oldIndex, newIndex)
    const priorities = selectedBindings.map(binding => binding.priority).sort((left, right) => left - right)
    setBindings(current => current.map(binding => {
      const index = reordered.findIndex(item => item.id === binding.id)
      return index < 0 ? binding : { ...binding, priority: priorities[index] }
    }).sort((left, right) => left.priority - right.priority))
    const results = await Promise.all(reordered.map((binding, index) =>
      bindingApi.update(binding.id, { priority: priorities[index] }),
    ))
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
                          <span className="mt-1.5 block text-[10px] text-muted-foreground">{bindings.filter(binding => binding.providerId === provider.id).length} 个模型</span>
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
                    <div><div className="text-xs font-semibold">上游模型</div><div className="mt-0.5 text-[11px] text-muted-foreground">拖拽调整全局队列中的相对优先级</div></div>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openBindingDialog()}><Plus size={13} /> 添加模型</Button>
                  </div>
                  {selectedBindings.length ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={event => void handleDragEnd(event)}>
                      <SortableContext items={selectedBindings.map(binding => binding.id)} strategy={verticalListSortingStrategy}>
                        <div className="divide-y rounded-md border">
                          {selectedBindings.map(binding => (
                            <SortableBinding key={binding.id} id={binding.id}>
                              {(handleProps, dragging) => (
                                <div className={cn('flex items-center gap-2 px-3 py-2.5', dragging && 'bg-muted/60')}>
                                  <button aria-label={`拖动 ${binding.upstreamModelId}`} className="cursor-grab touch-none text-muted-foreground/50" {...handleProps}><GripVertical size={14} /></button>
                                  <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">{binding.priority}</div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2"><span className="truncate text-xs font-semibold">{binding.upstreamModelId}</span><Badge variant="secondary" className="h-5 px-1.5 text-[9px]">{binding.protocol.toUpperCase()}</Badge>{!binding.upstreamUrl.trim() && <Badge variant="outline" className="h-5 px-1.5 text-[9px]">沿用默认</Badge>}</div>
                                    <div className="mt-1 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground"><Link2 size={10} /> {getEffectiveBindingUrl(binding, selectedProvider) || '未配置地址'}</div>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="编辑模型" onClick={() => openBindingDialog(binding)}><Pencil size={13} /></Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="删除模型" onClick={() => void removeBinding(binding)}><Trash2 size={13} /></Button>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingProviderId ? '编辑供应商' : '新建供应商'}</DialogTitle><DialogDescription>供应商负责保存 API Key 和请求超时。</DialogDescription></DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 py-2">
            <div className="space-y-1.5"><Label htmlFor="provider-name">供应商名称</Label><Input id="provider-name" value={providerName} onChange={event => setProviderName(event.target.value)} placeholder="例如：OpenAI" /><p className="text-[11px] text-muted-foreground">用于在列表中区分不同的服务渠道，例如 OpenAI、Anthropic、DeepSeek。</p></div>
            <div className="space-y-1.5"><Label htmlFor="provider-key">API Key</Label><div className="relative"><KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="provider-key" type="password" className="pl-8" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={editingProviderId ? '留空表示不修改' : 'sk-...'} /></div><p className="text-[11px] text-muted-foreground">密钥仅保存在本机，用于调用该供应商的上游接口。协议不同认证方式不同（OpenAI 用 Bearer，Anthropic 用 x-api-key）。</p></div>
            <div className="space-y-1.5"><Label htmlFor="provider-timeout">请求超时（毫秒）</Label><Input id="provider-timeout" type="number" min={1} value={timeout} onChange={event => setTimeout(event.target.value)} /><p className="text-[11px] text-muted-foreground">单个上游请求的等待上限，超时后自动切换到下一个候选绑定。默认 30000（30 秒）。</p></div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label>协议默认接口地址</Label>
                <p className="text-[11px] text-muted-foreground">按需添加协议，为每个协议配置该供应商的默认完整接口地址。添加模型时如不单独填写地址，将自动沿用这里的默认地址。</p>
              </div>
              {providerEndpointEntries.map((entry, index) => (
                <div key={index} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-medium text-muted-foreground">接口 {index + 1}</Label>
                    {providerEndpointEntries.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="移除该接口" onClick={() => removeProviderEndpointEntry(index)}><Trash2 size={13} /></Button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>请求协议</Label>
                    <Select value={entry.protocol} onValueChange={value => updateProviderEndpointEntry(index, { protocol: value as Protocol })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PROTOCOL_OPTIONS.map(option => <SelectItem key={option.value} value={option.value} disabled={providerEndpointEntries.some(other => other.protocol === option.value)}>{option.label}</SelectItem>)}</SelectContent></Select>
                    <p className="text-[11px] text-muted-foreground">{PROTOCOL_DESCRIPTIONS[entry.protocol]}</p>
                  </div>
                  <div className="space-y-1.5"><Label htmlFor={`provider-endpoint-url-${index}`}>完整接口地址</Label><Input id={`provider-endpoint-url-${index}`} type="url" className="font-mono text-xs" value={entry.url} onChange={event => updateProviderEndpointEntry(index, { url: event.target.value })} placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]} /><p className="text-[11px] text-muted-foreground">该协议下所有模型的默认请求地址。留空表示该协议暂未配置默认地址。</p></div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={addProviderEndpointEntry}><Plus size={13} /> 添加协议</Button>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setProviderDialogOpen(false)}>取消</Button><Button disabled={saving || !providerName.trim() || (!editingProviderId && !apiKey.trim())} onClick={() => void saveProvider()}>{saving ? '保存中...' : editingProviderId ? '保存修改' : '创建供应商'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bindingDialogOpen} onOpenChange={setBindingDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{editingBindingId ? '编辑上游模型' : '添加上游模型'}</DialogTitle><DialogDescription>一个模型可配置多个协议。接口地址可选，留空将使用该供应商在此协议下的默认地址。</DialogDescription></DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 py-2">
            {bindingEntries.map((entry, index) => (
              <div key={index} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">协议 {index + 1}</span>
                  {bindingEntries.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="移除该协议" onClick={() => removeBindingEntry(index)}><Trash2 size={13} /></Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label htmlFor={`binding-model-${index}`}>上游模型 ID</Label><Input id={`binding-model-${index}`} className="font-mono text-xs" value={entry.upstreamModelId} onChange={event => updateBindingEntry(index, { upstreamModelId: event.target.value })} placeholder="gpt-4o" /><p className="text-[11px] text-muted-foreground">该供应商上的实际模型名，发起请求时代理会自动替换。</p></div>
                  <div className="space-y-1.5"><Label>请求协议</Label><Select value={entry.protocol} onValueChange={value => updateBindingEntryProtocol(index, value as Protocol)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PROTOCOL_OPTIONS.map(option => <SelectItem key={option.value} value={option.value} disabled={usedProtocols.includes(option.value)}>{option.label}</SelectItem>)}</SelectContent></Select><p className="text-[11px] text-muted-foreground">每个协议仅能配置一个，已选中的协议在其它条目不显示。</p></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor={`binding-url-${index}`}>完整接口地址（可选）</Label><Input id={`binding-url-${index}`} type="url" className="font-mono text-xs" value={entry.upstreamUrl} onChange={event => updateBindingEntry(index, { upstreamUrl: event.target.value })} placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]} /><p className="text-[11px] text-muted-foreground">留空则使用供应商在该协议下的默认接口地址。如需覆盖供应商默认地址，可在此填写完整地址。</p></div>
                <ProtocolUrlHint protocol={entry.protocol} />
              </div>
            ))}
            {!editingBindingId && (
              <Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={addBindingEntry}><Plus size={13} /> 添加协议</Button>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setBindingDialogOpen(false)}>取消</Button><Button disabled={saving || bindingEntries.length === 0 || bindingEntries.some(entry => !entry.upstreamModelId.trim())} onClick={() => void saveBinding()}>{saving ? '保存中...' : editingBindingId ? '保存修改' : '添加模型'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}
