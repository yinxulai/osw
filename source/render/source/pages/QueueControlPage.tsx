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
import { Circle, CircleDot, Copy, GripVertical, KeyRound, Plug, RefreshCw, Server, Target } from 'lucide-react'
import type { LogicalModel, ModelBinding, Provider, ProviderHealth, Settings } from '@common/schemas'
import { bindingApi, healthApi, logicalModelApi, providerApi, proxyApi, queueApi, settingsApi, type ProxyServerStatus } from '@/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'

interface SortableBindingProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

function SortableBinding(props: SortableBindingProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('relative bg-card', isDragging && 'z-10 shadow-md')}>
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}

export default function QueueControlPage() {
  const [logicalModel, setLogicalModel] = useState<LogicalModel | null>(null)
  const [bindings, setBindings] = useState<ModelBinding[]>([])
  const [providers, setProviders] = useState<Record<string, Provider>>({})
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({})
  const [settings, setSettings] = useState<Settings | null>(null)
  const [proxyStatus, setProxyStatus] = useState<ProxyServerStatus | null>(null)
  const [manualBindingId, setManualBindingId] = useState<string | null>(null)
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const loadData = async () => {
    setLoading(true)
    setErrorMessage('')
    const [modelResult, providerResult, healthResult, settingsResult, statusResult, queueResult] = await Promise.all([
      logicalModelApi.list(),
      providerApi.list(),
      healthApi.list(),
      settingsApi.get(),
      proxyApi.status(),
      queueApi.status(),
    ])
    const failed = [modelResult, providerResult, healthResult, settingsResult, statusResult, queueResult].find(result => !result.success)
    if (failed && !failed.success) {
      setErrorMessage(failed.errorMessage)
      setLoading(false)
      return
    }
    if (!modelResult.success || !providerResult.success || !healthResult.success || !settingsResult.success || !statusResult.success || !queueResult.success) return
    const currentModel = modelResult.data.find(model => model.enabled) ?? modelResult.data[0] ?? null
    const bindingResult = currentModel ? await bindingApi.list(currentModel.id) : null
    if (bindingResult && !bindingResult.success) {
      setErrorMessage(bindingResult.errorMessage)
      setLoading(false)
      return
    }
    setLogicalModel(currentModel)
    setBindings(bindingResult?.success ? bindingResult.data : [])
    setProviders(Object.fromEntries(providerResult.data.map(provider => [provider.id, provider])))
    setHealth(Object.fromEntries(healthResult.data.map(item => [item.providerId, item])))
    setSettings(settingsResult.data)
    setProxyStatus(statusResult.data)
    setManualBindingId(queueResult.data.manualBindingId)
    setMode(queueResult.data.manualBindingId ? 'manual' : 'auto')
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const proxyBaseUrl = proxyStatus ? `http://${proxyStatus.host}:${proxyStatus.port}` : ''

  const copyEndpoint = async () => {
    await navigator.clipboard.writeText(proxyBaseUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const changeMode = async (nextMode: string) => {
    if (nextMode === 'auto') {
      const result = await queueApi.switch(null)
      if (!result.success) return setErrorMessage(result.errorMessage)
      setManualBindingId(null)
      setMode('auto')
      return
    }
    const initialBindingId = manualBindingId ?? bindings.find(binding => binding.enabled)?.id ?? null
    if (!initialBindingId) return
    const result = await queueApi.switch(initialBindingId)
    if (!result.success) return setErrorMessage(result.errorMessage)
    setManualBindingId(initialBindingId)
    setMode('manual')
  }

  const selectManualBinding = async (binding: ModelBinding) => {
    if (mode !== 'manual' || !binding.enabled || isCooling(binding.providerId)) return
    const result = await queueApi.switch(binding.id)
    if (!result.success) return setErrorMessage(result.errorMessage)
    setManualBindingId(binding.id)
  }

  const isCooling = (providerId: string) => {
    const cooldownUntil = health[providerId]?.cooldownUntilTime
    return Boolean(cooldownUntil && cooldownUntil > Date.now())
  }

  const updateEnabled = async (binding: ModelBinding, enabled: boolean) => {
    const result = await bindingApi.update(binding.id, { enabled })
    if (!result.success) return setErrorMessage(result.errorMessage)
    setBindings(current => current.map(item => item.id === binding.id ? result.data : item))
    if (!enabled && manualBindingId === binding.id) await changeMode('auto')
  }

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = bindings.findIndex(binding => binding.id === active.id)
    const newIndex = bindings.findIndex(binding => binding.id === over.id)
    const reordered = arrayMove(bindings, oldIndex, newIndex).map((binding, index) => ({ ...binding, priority: index + 1 }))
    setBindings(reordered)
    const results = await Promise.all(reordered.map(binding => bindingApi.update(binding.id, { priority: binding.priority })))
    if (results.some(result => !result.success)) {
      setErrorMessage('队列顺序保存失败，已恢复服务端数据')
      await loadData()
    }
  }

  const savePolicy = async () => {
    if (!settings) return
    setSaving(true)
    const result = await settingsApi.update({
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold,
      cooldownBaseSeconds: settings.cooldownBaseSeconds,
      cooldownMaxSeconds: settings.cooldownMaxSeconds,
      idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
    })
    setSaving(false)
    if (!result.success) return setErrorMessage(result.errorMessage)
    setSettings(result.data)
  }

  const toggleProxy = async () => {
    const result = proxyStatus?.running ? await proxyApi.stop() : await proxyApi.start()
    if (!result.success) return setErrorMessage(result.errorMessage)
    setProxyStatus(result.data)
  }

  return (
    <PageLayout>
      <PageHeader title="模型队列" description="管理请求优先级和故障转移策略" />
      <PageContent>
        {errorMessage && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{errorMessage}</div>}
        {loading ? (
          <Card className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">正在加载队列配置...</Card>
        ) : (
          <>
            <Card>
              <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                <div className="flex items-start gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Server size={16} /></div><div><CardTitle>服务接入配置</CardTitle><CardDescription className="mt-0.5">所有协议统一使用同一个本地 Base URL</CardDescription></div></div>
                <Button variant={proxyStatus?.running ? 'outline' : 'default'} size="sm" className="h-8 text-xs" onClick={() => void toggleProxy()}>{proxyStatus?.running ? '暂停服务' : '启动服务'}</Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_1fr]">
                  <div className="space-y-1.5"><Label className="text-[11px] text-muted-foreground"><Plug size={11} className="mr-1 inline" />代理地址</Label><div className="flex gap-2"><Input readOnly value={proxyBaseUrl} className="h-8 font-mono text-xs" /><Button variant="secondary" size="sm" className="h-8 text-xs" disabled={!proxyStatus?.running} onClick={() => void copyEndpoint()}><Copy size={13} /> {copied ? '已复制' : '复制'}</Button></div></div>
                  <div className="space-y-1.5"><Label className="text-[11px] text-muted-foreground"><KeyRound size={11} className="mr-1 inline" />服务状态</Label><div className="flex h-8 items-center rounded-md border px-3"><span className={cn('mr-2 h-1.5 w-1.5 rounded-full', proxyStatus?.running ? 'bg-success' : 'bg-muted-foreground')} /><span className="text-xs">{proxyStatus?.running ? '运行中' : '已暂停'}</span></div></div>
                </div>
                <div className="flex flex-wrap gap-2">{(['openai-completions', 'openai-responses', 'anthropic-messages'] as const).map(protocol => <Badge key={protocol} variant="secondary">{protocol.toUpperCase()} · {bindings.filter(binding => binding.protocol === protocol && binding.enabled).length}</Badge>)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                <div><CardTitle>优先级队列</CardTitle><CardDescription className="mt-1">逻辑模型 {logicalModel?.name ?? '尚未配置'}，拖拽后立即保存</CardDescription></div>
                <Tabs value={mode} onValueChange={value => void changeMode(value)}><TabsList className="h-7"><TabsTrigger value="auto" className="h-6 px-2.5 text-[11px]"><RefreshCw size={12} /> 自动转移</TabsTrigger><TabsTrigger value="manual" className="h-6 px-2.5 text-[11px]"><Target size={12} /> 手动指定</TabsTrigger></TabsList></Tabs>
              </CardHeader>
              <CardContent className="pt-0">
                {bindings.length ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={event => void handleDragEnd(event)}>
                    <SortableContext items={bindings.map(binding => binding.id)} strategy={verticalListSortingStrategy}>
                      <div className="-mx-4 divide-y border-t">
                        {bindings.map(binding => {
                          const provider = providers[binding.providerId]
                          const cooling = isCooling(binding.providerId)
                          const selected = mode === 'manual' && manualBindingId === binding.id
                          return (
                            <SortableBinding key={binding.id} id={binding.id}>
                              {(handleProps, dragging) => (
                                <div onClick={() => void selectManualBinding(binding)} className={cn('flex items-center gap-2 border-l-2 border-l-transparent px-4 py-2.5', selected && 'border-l-primary bg-primary/5', mode === 'manual' && binding.enabled && !cooling && 'cursor-pointer hover:bg-muted/40', dragging && 'bg-muted/60')}>
                                  {mode === 'manual' ? selected ? <CircleDot size={16} className="text-primary" /> : <Circle size={16} className="text-muted-foreground/40" /> : <button aria-label={`拖动 ${binding.upstreamModelId}`} className="cursor-grab touch-none text-muted-foreground/50" {...handleProps}><GripVertical size={14} /></button>}
                                  <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">{binding.priority}</div>
                                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-xs font-semibold">{provider?.name ?? '未知供应商'}</span><span className="truncate font-mono text-[11px] text-muted-foreground">{binding.upstreamModelId}</span></div><div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{binding.upstreamUrl}</div></div>
                                  <Badge variant={cooling ? 'destructive' : binding.enabled ? 'success' : 'muted'}>{cooling ? '冷却中' : binding.enabled ? selected ? '当前指定' : '待命' : '已禁用'}</Badge>
                                  <Switch checked={binding.enabled} onCheckedChange={enabled => void updateEnabled(binding, enabled)} onClick={event => event.stopPropagation()} aria-label={`${binding.upstreamModelId} 启用状态`} />
                                </div>
                              )}
                            </SortableBinding>
                          )
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : <div className="flex min-h-40 items-center justify-center border-t text-xs text-muted-foreground">请先在模型管理中添加上游模型。</div>}
              </CardContent>
            </Card>

            {settings && (
              <Card>
                <CardHeader className="pb-2"><CardTitle>转移策略</CardTitle><CardDescription>保存后对新请求立即生效</CardDescription></CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5"><Label htmlFor="failure-threshold" className="text-xs">失败阈值</Label><Input id="failure-threshold" type="number" min={1} className="h-8 text-xs" value={settings.consecutiveFailureThreshold} onChange={event => setSettings({ ...settings, consecutiveFailureThreshold: Number(event.target.value) })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="cooldown-base" className="text-xs">初始冷却（秒）</Label><Input id="cooldown-base" type="number" min={1} className="h-8 text-xs" value={settings.cooldownBaseSeconds} onChange={event => setSettings({ ...settings, cooldownBaseSeconds: Number(event.target.value) })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="cooldown-max" className="text-xs">最大冷却（秒）</Label><Input id="cooldown-max" type="number" min={1} className="h-8 text-xs" value={settings.cooldownMaxSeconds} onChange={event => setSettings({ ...settings, cooldownMaxSeconds: Number(event.target.value) })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="idle-timeout" className="text-xs">空闲超时（毫秒）</Label><Input id="idle-timeout" type="number" min={1} className="h-8 text-xs" value={settings.idleTimeoutMilliseconds} onChange={event => setSettings({ ...settings, idleTimeoutMilliseconds: Number(event.target.value) })} /></div>
                  </div>
                  <div className="flex justify-end"><Button size="sm" className="h-8 text-xs" disabled={saving} onClick={() => void savePolicy()}>{saving ? '保存中...' : '保存策略'}</Button></div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
