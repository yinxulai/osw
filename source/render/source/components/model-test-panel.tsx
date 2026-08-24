import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  FlaskConical,
  Loader2,
  Play,
  Repeat,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react'
import type { Protocol, Provider, ProviderModelRoute } from '@common/schemas'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { modelTestApi, type ModelTestResult } from '@/api/tools'
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
  models: ProviderModelRoute[]
  providers: Provider[]
}

type TestTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

interface TestTask {
  id: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  converted: boolean
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

const TASK_STATUS_LABELS: Record<TestTaskStatus, string> = {
  queued: '等待',
  running: '请求中',
  success: '通过',
  failed: '失败',
  cancelled: '已取消',
}

function getTestableProtocols(model: ProviderModelRoute): Protocol[] {
  const protocols = new Set(model.endpoints.map(endpoint => endpoint.protocol))
  for (const endpoint of model.endpoints) {
    if (!endpoint.protocolConversionEnabled) continue
    for (const protocol of CONVERTIBLE_PROTOCOLS[endpoint.protocol]) protocols.add(protocol)
  }
  return [...protocols]
}

function supportsConvertedProtocol(model: ProviderModelRoute, protocol: Protocol): boolean {
  return !model.endpoints.some(endpoint => endpoint.protocol === protocol)
    && model.endpoints.some(endpoint => endpoint.protocolConversionEnabled && CONVERTIBLE_PROTOCOLS[endpoint.protocol].includes(protocol))
}

interface ProtocolButtonState {
  converted: boolean
  selected: boolean
}

interface ProtocolButtonLabelOptions {
  converted: boolean
  protocol: Protocol
}

function getProtocolButtonClassName(state: ProtocolButtonState): string {
  if (state.converted) {
    if (state.selected) return 'border border-dashed border-amber-500/70 bg-amber-500/15 text-amber-700 dark:text-amber-300'
    return 'border border-dashed border-amber-500/50 bg-muted/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'
  }
  if (state.selected) return 'bg-primary text-primary-foreground'
  return 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
}

function getProtocolButtonLabel(options: ProtocolButtonLabelOptions): string {
  return `${PROTOCOL_LABELS[options.protocol]}${options.converted ? '（转换）' : ''}`
}

function getProtocolButtonTitle(options: ProtocolButtonLabelOptions): string {
  const label = PROTOCOL_LABELS[options.protocol]
  return options.converted ? `${label}（经协议转换支持）` : label
}

function getTaskResponseSummary(task: TestTask): string {
  const status = task.result?.statusCode ? `HTTP ${task.result.statusCode} · ` : ''
  const duration = task.result ? `${task.result.durationMilliseconds}ms` : '—'
  return `${status}${duration}`
}

interface TaskStatusProps {
  status: TestTaskStatus
}

function TaskStatus(props: TaskStatusProps) {
  const { status } = props
  if (status === 'running') return <Loader2 size={15} className="animate-spin text-primary" />
  if (status === 'success') return <CheckCircle2 size={15} className="text-emerald-600" />
  if (status === 'failed') return <XCircle size={15} className="text-red-600" />
  if (status === 'cancelled') return <Square size={13} className="text-muted-foreground" />
  return <Circle size={15} className="text-muted-foreground/35" />
}

interface ModelSelectionProps {
  allTasksSelected: boolean
  availableProviders: Provider[]
  enabledModels: ProviderModelRoute[]
  running: boolean
  selectedModelProtocols: Record<string, Set<Protocol>>
  selectedProviderIds: Set<string>
  onToggleAll: () => void
  onToggleModelProtocol: (modelId: string, protocol: Protocol) => void
  onToggleProvider: (providerId: string) => void
}

function ModelSelection(props: ModelSelectionProps) {
  const providerViews = useMemo(() => props.availableProviders.map(provider => {
    const selected = props.selectedProviderIds.has(provider.id)
    const models = props.enabledModels
      .filter(model => model.providerId === provider.id)
      .map(model => {
        const protocols = getTestableProtocols(model)
        const selectedProtocols = props.selectedModelProtocols[model.id] ?? new Set(protocols)
        return {
          model,
          selectedCount: selectedProtocols.size,
          protocols: protocols.map(protocol => {
            const converted = supportsConvertedProtocol(model, protocol)
            const protocolSelected = selectedProtocols.has(protocol)
            return {
              protocol,
              converted,
              selected: protocolSelected,
              label: getProtocolButtonLabel({ converted, protocol }),
              title: getProtocolButtonTitle({ converted, protocol }),
              className: getProtocolButtonClassName({ converted, selected: protocolSelected }),
            }
          }),
        }
      })
    return {
      provider,
      selected,
      models,
      selectedCount: models.filter(model => model.selectedCount > 0).length,
    }
  }), [props.availableProviders, props.enabledModels, props.selectedModelProtocols, props.selectedProviderIds])

  return (
    <aside className="min-h-0 overflow-y-auto bg-muted/20 p-3 lg:bg-muted/10">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="text-[11px] font-medium text-foreground">待测模型</div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" disabled={props.running || props.enabledModels.length === 0} onClick={props.onToggleAll}>
            {props.allTasksSelected ? '取消全选' : '全选'}
          </Button>
          <div className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{props.selectedProviderIds.size}/{props.availableProviders.length}</div>
        </div>
      </div>
      <div className="space-y-3">
        {providerViews.map(providerView => (
          <div key={providerView.provider.id} className="rounded-lg bg-background/60 p-2">
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                providerView.selected ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
              onClick={() => props.onToggleProvider(providerView.provider.id)}
            >
              <span className={cn('flex size-3.5 items-center justify-center rounded-[3px] border', providerView.selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background')}>
                {providerView.selected && <Check size={9} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{providerView.provider.name}</span>
              <span className="font-mono text-[9px] text-muted-foreground">{providerView.selectedCount}/{providerView.models.length}</span>
            </button>

            {providerView.selected && (
              <div className="mt-2 space-y-2">
                {providerView.models.map(modelView => (
                  <div key={modelView.model.id} className="rounded-md bg-background/80 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[10px] font-medium text-foreground">{modelView.model.modelName}</div>
                        <div className="mt-0.5 text-[9px] text-muted-foreground">{modelView.selectedCount}/{modelView.protocols.length} 协议</div>
                      </div>
                      <div className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{modelView.selectedCount}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {modelView.protocols.map(protocolView => (
                        <button
                          key={`${modelView.model.id}:${protocolView.protocol}`}
                          type="button"
                          aria-pressed={protocolView.selected}
                          title={protocolView.title}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium transition-all',
                            protocolView.className,
                          )}
                          onClick={() => props.onToggleModelProtocol(modelView.model.id, protocolView.protocol)}
                        >
                          {protocolView.converted && <Repeat size={9} />}
                          {protocolView.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}

interface TestProgressProps {
  cancelledCount: number
  failureCount: number
  progress: number
  running: boolean
  successCount: number
}

interface TestTaskRowProps {
  task: TestTask
}

interface EmptyTestTasksProps {
  hasEnabledModels: boolean
}

function TestProgress(props: TestProgressProps) {
  return (
    <div className="border-b border-border/30 px-4 py-3">
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-3">
          <span className="font-medium">{props.running ? '测试进行中' : props.failureCount > 0 ? '测试完成，存在异常' : props.cancelledCount > 0 ? '测试已取消' : '全部测试通过'}</span>
          <span className="text-emerald-600">通过 {props.successCount}</span>
          <span className={props.failureCount > 0 ? 'text-red-600' : 'text-muted-foreground'}>失败 {props.failureCount}</span>
          {props.cancelledCount > 0 && <span className="text-muted-foreground">取消 {props.cancelledCount}</span>}
        </div>
        <span className="font-mono text-muted-foreground">{props.progress}%</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted"><div className={cn('h-full transition-all duration-300', props.failureCount > 0 && !props.running ? 'bg-red-500' : 'bg-primary')} style={{ width: `${props.progress}%` }} /></div>
    </div>
  )
}

function TestTaskRow(props: TestTaskRowProps) {
  const { task } = props
  const responseSummary = getTaskResponseSummary(task)
  return (
    <div className="grid gap-2 border-b border-border px-3 py-2.5 last:border-b-0 md:grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_80px_140px] md:items-center md:gap-3">
      <TaskStatus status={task.status} />
      <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-medium">{task.providerName}</span><span className="truncate font-mono text-[10px] text-muted-foreground">{task.modelName}</span></div></div>
      <div className="min-w-0 text-[11px] text-muted-foreground"><span className={cn('truncate', task.converted && 'text-amber-700 dark:text-amber-300')}>{PROTOCOL_LABELS[task.protocol]}{task.converted ? '（转换）' : ''}</span></div>
      <div className={cn('text-[10px] font-medium', task.status === 'success' && 'text-emerald-600', task.status === 'failed' && 'text-red-600', task.status === 'running' && 'text-primary', task.status === 'cancelled' && 'text-muted-foreground')}>{TASK_STATUS_LABELS[task.status]}</div>
      <div className="text-[10px] text-muted-foreground md:text-right">{responseSummary}{task.result?.success && <span className="ml-1 font-mono">↓{task.result.outputTokens ?? '—'}</span>}</div>
      {task.errorMessage && <div className="col-span-full ml-9 wrap-break-word rounded-md bg-red-500/[0.07] px-2.5 py-2 font-mono text-[10px] text-red-600 dark:text-red-400">{task.errorMessage}</div>}
    </div>
  )
}

function EmptyTestTasks(props: EmptyTestTasksProps) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted/30 text-muted-foreground"><Cpu size={18} /></div>
      <div className="text-xs font-medium">{props.hasEnabledModels ? '当前范围没有测试任务' : '没有可测试的供应商模型'}</div>
      <div className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">
        {props.hasEnabledModels ? '在左侧列表中勾选需要测试的渠道和协议，结果会在这里展示。' : '请先在模型管理中添加并启用供应商模型，然后返回这里验证协议与渠道。'}
      </div>
    </div>
  )
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
  const previousOpen = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const isOpening = props.open && !previousOpen.current
    previousOpen.current = props.open
    if (!props.open) return

    setSelectedModelProtocols(current => {
      if (isOpening) return {}
      return Object.fromEntries(enabledModels.map(model => [
        model.id,
        new Set([...current[model.id] ?? []].filter(protocol => getTestableProtocols(model).includes(protocol))),
      ]))
    })
    setSelectedProviderIds(current => isOpening
      ? new Set()
      : new Set([...current].filter(providerId => availableProviders.some(provider => provider.id === providerId))))
    if (isOpening) {
      setTasks([])
      setRunning(false)
    }
  }, [props.open, enabledModels, availableProviders])

  const plannedTasks = useMemo<TestTask[]>(() => enabledModels.flatMap(model => {
    if (!selectedProviderIds.has(model.providerId)) return []
    const provider = props.providers.find(item => item.id === model.providerId)
    if (!provider) return []
    const selectedProtocols = selectedModelProtocols[model.id] ?? new Set(getTestableProtocols(model))
    return getTestableProtocols(model).filter(protocol => selectedProtocols.has(protocol)).map(protocol => ({
      id: `${model.id}:${protocol}`,
      modelId: model.id,
      modelName: model.modelName,
      providerId: provider.id,
      providerName: provider.name,
      protocol,
      converted: supportsConvertedProtocol(model, protocol),
      status: 'queued' as const,
    }))
  }), [enabledModels, props.providers, selectedModelProtocols, selectedProviderIds])

  const visibleTasks = tasks.length > 0 ? tasks : plannedTasks
  const completedCount = tasks.filter(task => task.status === 'success' || task.status === 'failed' || task.status === 'cancelled').length
  const successCount = tasks.filter(task => task.status === 'success').length
  const failureCount = tasks.filter(task => task.status === 'failed').length
  const cancelledCount = tasks.filter(task => task.status === 'cancelled').length
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

  const allTasksSelected = enabledModels.length > 0
    && enabledModels.every(model => selectedProviderIds.has(model.providerId)
      && getTestableProtocols(model).every(protocol => selectedModelProtocols[model.id]?.has(protocol)))

  const toggleAll = () => {
    if (running) return
    if (allTasksSelected) {
      setSelectedProviderIds(new Set())
      setSelectedModelProtocols(Object.fromEntries(enabledModels.map(model => [model.id, new Set<Protocol>()])))
    } else {
      setSelectedProviderIds(new Set(availableProviders.map(provider => provider.id)))
      setSelectedModelProtocols(Object.fromEntries(
        enabledModels.map(model => [model.id, new Set(getTestableProtocols(model))]),
      ))
    }
    clearTasks()
  }

  const runTests = async () => {
    if (plannedTasks.length === 0 || running) return
    const pendingTasks = plannedTasks.map(task => ({ ...task }))
    const controller = new AbortController()
    abortControllerRef.current = controller
    setTasks(pendingTasks)
    setRunning(true)
    let nextIndex = 0

    const worker = async () => {
      while (!controller.signal.aborted && nextIndex < pendingTasks.length) {
        const task = pendingTasks[nextIndex++]
        setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'running' } : item))
        try {
          const response = await modelTestApi.run(task.protocol, {
            providerIds: [task.providerId],
            modelIds: [task.modelId],
          }, controller.signal)
          if (controller.signal.aborted) break
          const result = response.success
            ? response.data.results.find(item => item.modelId === task.modelId)
            : undefined
          const succeeded = Boolean(result?.success)
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: succeeded ? 'success' : 'failed',
            result,
            errorMessage: response.success ? result?.errorMessage ?? '未找到可测试的协议端点，请刷新模型配置后重试' : response.errorMessage,
          } : item))
        } catch (error) {
          if (controller.signal.aborted) break
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : '诊断请求失败',
          } : item))
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, pendingTasks.length) }, () => worker()))
    } finally {
      if (controller.signal.aborted) {
        setTasks(current => current.map(task => task.status === 'queued' || task.status === 'running'
          ? { ...task, status: 'cancelled', errorMessage: undefined }
          : task))
      }
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setRunning(false)
    }
  }

  const cancelTests = () => abortControllerRef.current?.abort()

  return (
    <Dialog open={props.open} onOpenChange={open => !running && props.onOpenChange(open)}>
      <DialogContent className="flex h-[min(760px,90vh)] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="bg-muted/15 px-5 py-4 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><FlaskConical size={15} /></div>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-sm">
                渠道诊断
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px]">向选中的上游发送最小真实请求，验证连通性和协议兼容性；测试可能产生少量费用。</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
          <ModelSelection
            allTasksSelected={allTasksSelected}
            availableProviders={availableProviders}
            enabledModels={enabledModels}
            running={running}
            selectedModelProtocols={selectedModelProtocols}
            selectedProviderIds={selectedProviderIds}
            onToggleAll={toggleAll}
            onToggleModelProtocol={toggleModelProtocol}
            onToggleProvider={toggleProvider}
          />

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
                  {running ? (
                    <Button variant="secondary" size="sm" onClick={cancelTests}>
                      <Square size={11} fill="currentColor" /> 停止测试
                    </Button>
                  ) : (
                    <Button size="sm" disabled={plannedTasks.length === 0} onClick={() => void runTests()}>
                      <Play size={12} /> 运行测试
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {(running || tasks.length > 0) && (
              <TestProgress
                cancelledCount={cancelledCount}
                failureCount={failureCount}
                progress={progress}
                running={running}
                successCount={successCount}
              />
            )}

            <main className="min-h-0 flex-1 overflow-auto p-4">
              {visibleTasks.length > 0 ? (
                <div className="overflow-hidden rounded-md border bg-card">
                  <div className="hidden grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_80px_140px] gap-3 border-b border-border bg-muted/30 px-3 py-2 font-mono text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:grid"><span /><span>目标</span><span>协议</span><span>结果</span><span className="text-right">响应</span></div>
                  {visibleTasks.map(task => <TestTaskRow key={task.id} task={task} />)}
                </div>
              ) : (
                <EmptyTestTasks hasEnabledModels={enabledModels.length > 0} />
              )}
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
