import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  FlaskConical,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import type { Protocol, Provider, UpstreamModel } from '@common/schemas'
import { modelTestApi, type ModelTestResult } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ModelTestPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: UpstreamModel[]
  providers: Provider[]
}

type TestTaskStatus = 'queued' | 'running' | 'success' | 'failed'

interface TestTask {
  id: string
  modelId: string
  upstreamModelId: string
  providerId: string
  providerName: string
  protocol: Protocol
  status: TestTaskStatus
  result?: ModelTestResult
  errorMessage?: string
}

const PROTOCOL_LABELS: Record<Protocol, string> = {
  'openai-completions': 'Chat Completions',
  'openai-responses': 'Responses',
  'anthropic-messages': 'Messages',
}

const TEST_CONCURRENCY = 3

interface TaskStatusProps {
  status: TestTaskStatus
}

function TaskStatus(props: TaskStatusProps) {
  const { status } = props
  if (status === 'running') return <Loader2 size={15} className="animate-spin text-primary" />
  if (status === 'success') return <CheckCircle2 size={15} className="text-emerald-600" />
  if (status === 'failed') return <XCircle size={15} className="text-red-600" />
  return <Circle size={15} className="text-muted-foreground/35" />
}

export function ModelTestPanel(props: ModelTestPanelProps) {
  const enabledModels = useMemo(() => props.models.filter(model => model.enabled), [props.models])
  const availableProviders = useMemo(
    () => props.providers.filter(provider => enabledModels.some(model => model.providerId === provider.id)),
    [enabledModels, props.providers],
  )
  const [selectedModelProtocols, setSelectedModelProtocols] = useState<Record<string, Set<Protocol>>>({})
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<TestTask[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!props.open) return
    const nextModelProtocols = Object.fromEntries(
      enabledModels.map(model => [model.id, new Set(model.endpoints.map(endpoint => endpoint.protocol))]),
    )
    setSelectedModelProtocols(nextModelProtocols)
    setSelectedProviderIds(new Set(availableProviders.map(provider => provider.id)))
    setTasks([])
    setRunning(false)
  }, [props.open, enabledModels, availableProviders])

  const plannedTasks = useMemo<TestTask[]>(() => enabledModels.flatMap(model => {
    if (!selectedProviderIds.has(model.providerId)) return []
    const provider = props.providers.find(item => item.id === model.providerId)
    if (!provider) return []
    const selectedProtocols = selectedModelProtocols[model.id] ?? new Set(model.endpoints.map(endpoint => endpoint.protocol))
    return model.endpoints.filter(endpoint => selectedProtocols.has(endpoint.protocol)).map(endpoint => ({
      id: `${model.id}:${endpoint.protocol}`,
      modelId: model.id,
      upstreamModelId: model.upstreamModelId,
      providerId: provider.id,
      providerName: provider.name,
      protocol: endpoint.protocol,
      status: 'queued' as const,
    }))
  }), [enabledModels, props.providers, selectedModelProtocols, selectedProviderIds])

  const visibleTasks = tasks.length > 0 ? tasks : plannedTasks
  const completedCount = tasks.filter(task => task.status === 'success' || task.status === 'failed').length
  const successCount = tasks.filter(task => task.status === 'success').length
  const failureCount = tasks.filter(task => task.status === 'failed').length
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100)

  const clearTasks = () => setTasks([])
  const toggleModelProtocol = (modelId: string, protocol: Protocol) => {
    if (running) return
    setSelectedModelProtocols(current => {
      const next = { ...current }
      const selectedProtocols = new Set(current[modelId] ?? [])
      if (selectedProtocols.has(protocol)) selectedProtocols.delete(protocol)
      else selectedProtocols.add(protocol)
      next[modelId] = selectedProtocols
      return next
    })
    clearTasks()
  }

  const toggleProvider = (providerId: string) => {
    if (running) return
    setSelectedProviderIds(current => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
    clearTasks()
  }

  const runTests = async () => {
    if (plannedTasks.length === 0 || running) return
    const pendingTasks = plannedTasks.map(task => ({ ...task }))
    setTasks(pendingTasks)
    setRunning(true)
    let nextIndex = 0

    const worker = async () => {
      while (nextIndex < pendingTasks.length) {
        const task = pendingTasks[nextIndex++]
        setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'running' } : item))
        const response = await modelTestApi.run(task.protocol, {
          providerIds: [task.providerId],
          modelIds: [task.modelId],
        })
        const result = response.success ? response.data.results[0] : undefined
        const succeeded = Boolean(result?.success)
        setTasks(current => current.map(item => item.id === task.id ? {
          ...item,
          status: succeeded ? 'success' : 'failed',
          result,
          errorMessage: response.success ? result?.errorMessage ?? '没有返回测试结果' : response.errorMessage,
        } : item))
      }
    }

    await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, pendingTasks.length) }, () => worker()))
    setRunning(false)
  }

  return (
    <Dialog open={props.open} onOpenChange={open => !running && props.onOpenChange(open)}>
      <DialogContent className="flex max-h-[86vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/30 px-5 py-4 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-primary"><FlaskConical size={15} /></div>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-sm">
                渠道诊断
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px]">验证模型绑定的协议兼容性与上游连通性</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b border-border/30 bg-muted/10 p-3 lg:border-b-0 lg:border-r lg:border-r-border/30">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="text-[11px] font-medium text-foreground">待测模型</div>
              <div className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{selectedProviderIds.size}/{availableProviders.length}</div>
            </div>
            <div className="space-y-3">
              {availableProviders.map(provider => {
                const providerModels = enabledModels.filter(model => model.providerId === provider.id)
                const providerSelectedCount = providerModels.filter(model => {
                  const modelProtocols = selectedModelProtocols[model.id] ?? new Set(model.endpoints.map(endpoint => endpoint.protocol))
                  return modelProtocols.size > 0
                }).length

                return (
                  <div key={provider.id} className="rounded-lg bg-background/60 p-2">
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        selectedProviderIds.has(provider.id) ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                      onClick={() => toggleProvider(provider.id)}
                    >
                      <span className={cn('flex size-3.5 items-center justify-center rounded-[3px] border', selectedProviderIds.has(provider.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background')}>
                        {selectedProviderIds.has(provider.id) && <Check size={9} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{provider.name}</span>
                      <span className="font-mono text-[9px] text-muted-foreground">{providerSelectedCount}/{providerModels.length}</span>
                    </button>

                    {selectedProviderIds.has(provider.id) && (
                      <div className="mt-2 space-y-2">
                        {providerModels.map(model => {
                          const modelSelectedProtocols = selectedModelProtocols[model.id] ?? new Set(model.endpoints.map(endpoint => endpoint.protocol))
                          const selectedCount = modelSelectedProtocols.size

                          return (
                            <div key={model.id} className="rounded-md bg-background/80 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-[10px] font-medium text-foreground">{model.upstreamModelId}</div>
                                  <div className="mt-0.5 text-[9px] text-muted-foreground">{selectedCount}/{model.endpoints.length} 协议</div>
                                </div>
                                <div className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{selectedCount}</div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {model.endpoints.map(endpoint => (
                                  <button
                                    key={`${model.id}:${endpoint.protocol}`}
                                    type="button"
                                    aria-pressed={modelSelectedProtocols.has(endpoint.protocol)}
                                    className={cn(
                                      'inline-flex items-center rounded-md px-1.5 py-1 text-[10px] font-medium transition-all',
                                      modelSelectedProtocols.has(endpoint.protocol)
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                                    )}
                                    onClick={() => toggleModelProtocol(model.id, endpoint.protocol)}
                                  >
                                    {PROTOCOL_LABELS[endpoint.protocol]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-border/30 bg-muted/10 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-foreground">测试配置</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{plannedTasks.length} 个目标协议任务 · {selectedProviderIds.size} 个渠道已选中</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-md bg-muted/60 px-2 py-1 font-mono text-[10px] tabular-nums text-muted-foreground">{plannedTasks.length} 项</span>
                  {tasks.length > 0 && !running && <Button variant="ghost" size="icon-sm" title="清除结果" onClick={clearTasks}><RotateCcw size={13} /></Button>}
                  <Button size="sm" disabled={plannedTasks.length === 0 || running} onClick={() => void runTests()}>
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {running ? `${completedCount}/${tasks.length}` : '运行测试'}
                  </Button>
                </div>
              </div>
            </div>

            {(running || tasks.length > 0) && (
              <div className="border-b border-border/30 px-4 py-3">
                <div className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{running ? '测试进行中' : failureCount > 0 ? '测试完成，存在异常' : '全部测试通过'}</span>
                    <span className="text-emerald-600">通过 {successCount}</span>
                    <span className={failureCount > 0 ? 'text-red-600' : 'text-muted-foreground'}>失败 {failureCount}</span>
                  </div>
                  <span className="font-mono text-muted-foreground">{progress}%</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted"><div className={cn('h-full transition-all duration-300', failureCount > 0 && !running ? 'bg-red-500' : 'bg-primary')} style={{ width: `${progress}%` }} /></div>
              </div>
            )}

            <main className="min-h-0 flex-1 overflow-auto p-4">
              {visibleTasks.length > 0 ? (
                <div className="overflow-hidden rounded-md border bg-card">
                  <div className="hidden grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_80px_140px] gap-3 border-b border-border bg-muted/30 px-3 py-2 font-mono text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:grid"><span /><span>目标</span><span>协议</span><span>结果</span><span className="text-right">响应</span></div>
                  {visibleTasks.map(task => {
                    return <div key={task.id} className="grid gap-2 border-b border-border px-3 py-2.5 last:border-b-0 md:grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_80px_140px] md:items-center md:gap-3">
                      <TaskStatus status={task.status} />
                      <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-medium">{task.providerName}</span><span className="truncate font-mono text-[10px] text-muted-foreground">{task.upstreamModelId}</span></div></div>
                      <div className="min-w-0 text-[11px] text-muted-foreground"><span className="truncate">{PROTOCOL_LABELS[task.protocol]}</span></div>
                      <div className={cn('text-[10px] font-medium', task.status === 'success' && 'text-emerald-600', task.status === 'failed' && 'text-red-600', task.status === 'running' && 'text-primary')}>{task.status === 'queued' ? '等待' : task.status === 'running' ? '请求中' : task.status === 'success' ? '通过' : '失败'}</div>
                      <div className="text-[10px] text-muted-foreground md:text-right">{task.result?.statusCode ? `HTTP ${task.result.statusCode} · ` : ''}{task.result ? `${task.result.durationMilliseconds}ms` : '—'}{task.result?.success && <span className="ml-1 font-mono">↓{task.result.outputTokens ?? '—'}</span>}</div>
                      {task.errorMessage && <div className="col-span-full ml-9 wrap-break-word rounded-md bg-red-500/[0.07] px-2.5 py-2 font-mono text-[10px] text-red-600 dark:text-red-400">{task.errorMessage}</div>}
                    </div>
                  })}
                </div>
              ) : (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted/30 text-muted-foreground"><Cpu size={18} /></div>
                  <div className="text-xs font-medium">{enabledModels.length === 0 ? '没有可测试的模型绑定' : '当前范围没有测试任务'}</div>
                  <div className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">
                    {enabledModels.length === 0 ? '请先在模型管理中添加并启用上游模型，然后返回这里验证协议与渠道。' : '在左侧列表中勾选需要测试的渠道和协议，结果会在这里展示。'}
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
