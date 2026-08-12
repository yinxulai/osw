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

interface SortableBindingProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

function SortableBinding({ id, children }: SortableBindingProps) {
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
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false)
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null)
  const [protocol, setProtocol] = useState<Protocol>('openai')
  const [upstreamModelId, setUpstreamModelId] = useState('')
  const [upstreamUrl, setUpstreamUrl] = useState('')
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
    setProviderDialogOpen(true)
  }

  const saveProvider = async () => {
    if (!providerName.trim() || (!editingProviderId && !apiKey.trim())) return
    setSaving(true)
    const result = editingProviderId
      ? await providerApi.update(editingProviderId, {
          name: providerName.trim(),
          timeoutMilliseconds: Number(timeout),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
      : await providerApi.create({
          name: providerName.trim(),
          apiKey: apiKey.trim(),
          timeoutMilliseconds: Number(timeout),
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
    setProtocol(binding?.protocol ?? 'openai')
    setUpstreamModelId(binding?.upstreamModelId ?? '')
    setUpstreamUrl(binding?.upstreamUrl ?? '')
    setBindingDialogOpen(true)
  }

  const saveBinding = async () => {
    if (!logicalModel || !selectedProvider || !upstreamModelId.trim() || !upstreamUrl.trim()) return
    setSaving(true)
    const result = editingBindingId
      ? await bindingApi.update(editingBindingId, {
          protocol,
          upstreamModelId: upstreamModelId.trim(),
          upstreamUrl: upstreamUrl.trim(),
        })
      : await bindingApi.create({
          logicalModelId: logicalModel.id,
          providerId: selectedProvider.id,
          protocol,
          upstreamModelId: upstreamModelId.trim(),
          upstreamUrl: upstreamUrl.trim(),
          priority: bindings.length + 1,
        })
    setSaving(false)
    if (!result.success) return setErrorMessage(result.errorMessage)
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
                <CardDescription>密钥按供应商保存，接口地址由每个上游模型独立配置。</CardDescription>
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
                                    <div className="flex items-center gap-2"><span className="truncate text-xs font-semibold">{binding.upstreamModelId}</span><Badge variant="secondary" className="h-5 px-1.5 text-[9px]">{binding.protocol.toUpperCase()}</Badge></div>
                                    <div className="mt-1 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground"><Link2 size={10} /> {binding.upstreamUrl}</div>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingProviderId ? '编辑供应商' : '新建供应商'}</DialogTitle><DialogDescription>供应商负责保存 API Key 和请求超时。</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label htmlFor="provider-name">供应商名称</Label><Input id="provider-name" value={providerName} onChange={event => setProviderName(event.target.value)} placeholder="例如：OpenAI" /></div>
            <div className="space-y-1.5"><Label htmlFor="provider-key">API Key</Label><div className="relative"><KeyRound size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input id="provider-key" type="password" className="pl-8" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={editingProviderId ? '留空表示不修改' : 'sk-...'} /></div></div>
            <div className="space-y-1.5"><Label htmlFor="provider-timeout">请求超时（毫秒）</Label><Input id="provider-timeout" type="number" min={1} value={timeout} onChange={event => setTimeout(event.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setProviderDialogOpen(false)}>取消</Button><Button disabled={saving || !providerName.trim() || (!editingProviderId && !apiKey.trim())} onClick={() => void saveProvider()}>{saving ? '保存中...' : editingProviderId ? '保存修改' : '创建供应商'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bindingDialogOpen} onOpenChange={setBindingDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingBindingId ? '编辑上游模型' : '添加上游模型'}</DialogTitle><DialogDescription>接口地址应填写实际协议的完整请求地址。</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="binding-model">上游模型 ID</Label><Input id="binding-model" className="font-mono text-xs" value={upstreamModelId} onChange={event => setUpstreamModelId(event.target.value)} placeholder="gpt-4o" /></div>
              <div className="space-y-1.5"><Label htmlFor="binding-protocol">请求协议</Label><Select value={protocol} onValueChange={value => setProtocol(value as Protocol)}><SelectTrigger id="binding-protocol"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="gemini">Gemini</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="binding-url">完整接口地址</Label><Input id="binding-url" type="url" className="font-mono text-xs" value={upstreamUrl} onChange={event => setUpstreamUrl(event.target.value)} placeholder="https://api.example.com/v1/chat/completions" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setBindingDialogOpen(false)}>取消</Button><Button disabled={saving || !upstreamModelId.trim() || !upstreamUrl.trim()} onClick={() => void saveBinding()}>{saving ? '保存中...' : editingBindingId ? '保存修改' : '添加模型'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}
