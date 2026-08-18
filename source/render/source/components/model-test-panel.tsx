import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  FlaskConical,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  XCircle,
  Zap,
} from 'lucide-react'
import type { LogicalModel, Protocol, Provider, UpstreamModel } from '@common/schemas'
import { modelTestApi, type ModelTestResult } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ModelTestPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  logicalModel: LogicalModel | null
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

const PROTOCOL_ICONS: Record<Protocol, typeof MessageSquare> = {
  'openai-completions': MessageSquare,
  'openai-responses': Zap,
  'anthropic-messages': Activity,
}

const TEST_CONCURRENCY = 3

interface ProtocolButtonProps {
  selected: boolean
  label: string
  icon: typeof MessageSquare
  onClick: () => void
}

function ProtocolButton(props: ProtocolButtonProps) {
  const { selected, label, icon: Icon, onClick } = props
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={selected}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-md border transition-colors',
            selected
              ? 'border-primary/45 bg-primary/10 text-primary'
              : 'border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground',
          )}
          onClick={onClick}
        >
          <Icon size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

interface ProviderButtonProps {
  selected: boolean
  name: string
  modelCount: number
  onClick: () => void
}

function ProviderButton(props: ProviderButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-[11px] font-medium transition-colors',
        props.selected
          ? 'border-primary/35 bg-background text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border hover:bg-background/70 hover:text-foreground',
      )}
      onClick={props.onClick}
    >
      <span className={cn('flex size-3.5 items-center justify-center rounded-[3px] border', props.selected && 'border-primary bg-primary text-primary-foreground')}>
        {props.selected && <Check size={9} />}
      </span>
      <span>{props.name}</span>
      <span className="font-mono text-[9px] text-muted-foreground">{props.modelCount}</span>
    </button>
  )
}

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
  const availableProtocols = useMemo(
    () => Array.from(new Set(enabledModels.flatMap(model => model.endpoints.map(endpoint => endpoint.protocol)))),
    [enabledModels],
  )
  const availableProviders = useMemo(
    () => props.providers.filter(provider => enabledModels.some(model => model.providerId === provider.id)),
    [enabledModels, props.providers],
  )
  const [selectedProtocols, setSelectedProtocols] = useState<Set<Protocol>>(new Set())
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<TestTask[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setSelectedProtocols(new Set(availableProtocols))
    setSelectedProviderIds(new Set(availableProviders.map(provider => provider.id)))
    setTasks([])
    setRunning(false)
  }, [props.open, availableProtocols, availableProviders])

  const plannedTasks = useMemo<TestTask[]>(() => enabledModels.flatMap(model => {
    if (!selectedProviderIds.has(model.providerId)) return []
    const provider = props.providers.find(item => item.id === model.providerId)
    if (!provider) return []
    return model.endpoints.filter(endpoint => selectedProtocols.has(endpoint.protocol)).map(endpoint => ({
      id: `${model.id}:${endpoint.protocol}`,
      modelId: model.id,
      upstreamModelId: model.upstreamModelId,
      providerId: provider.id,
      providerName: provider.name,
      protocol: endpoint.protocol,
      status: 'queued' as const,
    }))
  }), [enabledModels, props.providers, selectedProtocols, selectedProviderIds])

  const visibleTasks = tasks.length > 0 ? tasks : plannedTasks
  const completedCount = tasks.filter(task => task.status === 'success' || task.status === 'failed').length
  const successCount = tasks.filter(task => task.status === 'success').length
  const failureCount = tasks.filter(task => task.status === 'failed').length
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100)

  const clearTasks = () => setTasks([])
  const toggleProtocol = (protocol: Protocol) => {
    if (running) return
    setSelectedProtocols(current => {
      const next = new Set(current)
      if (next.has(protocol)) next.delete(protocol)
      else next.add(protocol)
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
    if (!props.logicalModel || plannedTasks.length === 0 || running) return
    const pendingTasks = plannedTasks.map(task => ({ ...task }))
    setTasks(pendingTasks)
    setRunning(true)
    let nextIndex = 0

    const worker = async () => {
      while (nextIndex < pendingTasks.length) {
        const task = pendingTasks[nextIndex++]
        setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'running' } : item))
        const response = await modelTestApi.run(props.logicalModel!.id, task.protocol, {
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
      <DialogContent className="flex max-h-[86vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/45 text-primary"><FlaskConical size={15} /></div>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-sm">
                渠道诊断
                <span className="truncate font-mono text-[10px] font-normal text-muted-foreground">/ {props.logicalModel?.name ?? '未选择模型'}</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px]">验证模型绑定的协议兼容性与上游连通性</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="border-b bg-muted/18 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] font-medium uppercase tracking-wide text-muted-foreground">协议</span>
              <div className="flex items-center rounded-md border bg-muted/35 p-0.5">
                {availableProtocols.map(protocol => {
                  const Icon = PROTOCOL_ICONS[protocol]
                  return <ProtocolButton key={protocol} selected={selectedProtocols.has(protocol)} label={PROTOCOL_LABELS[protocol]} icon={Icon} onClick={() => toggleProtocol(protocol)} />
                })}
                {availableProtocols.length === 0 && <span className="px-2 text-[10px] text-muted-foreground">无可用协议</span>}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 font-mono text-[9px] font-medium uppercase tracking-wide text-muted-foreground">渠道</span>
              <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                {availableProviders.map(provider => <ProviderButton key={provider.id} selected={selectedProviderIds.has(provider.id)} name={provider.name} modelCount={enabledModels.filter(model => model.providerId === provider.id).length} onClick={() => toggleProvider(provider.id)} />)}
                {availableProviders.length === 0 && <span className="px-1 text-[10px] text-muted-foreground">无可用渠道</span>}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">{plannedTasks.length} 项</span>
              {tasks.length > 0 && !running && <Button variant="ghost" size="icon-sm" title="清除结果" onClick={clearTasks}><RotateCcw size={13} /></Button>}
              <Button size="sm" disabled={!props.logicalModel || plannedTasks.length === 0 || running} onClick={() => void runTests()}>
                {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {running ? `${completedCount}/${tasks.length}` : '运行测试'}
              </Button>
            </div>
          </div>
        </div>

        {(running || tasks.length > 0) && (
          <div className="border-b px-5 py-3">
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

        <main className="min-h-0 flex-1 overflow-auto p-5">
              {visibleTasks.length > 0 ? (
                <div className="overflow-hidden rounded-md border bg-background">
                  <div className="hidden grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_80px_140px] gap-3 border-b bg-muted/30 px-3 py-2 font-mono text-[9px] font-medium uppercase tracking-wide text-muted-foreground md:grid"><span /><span>目标</span><span>协议</span><span>结果</span><span className="text-right">响应</span></div>
                  {visibleTasks.map(task => {
                    const Icon = PROTOCOL_ICONS[task.protocol]
                    return <div key={task.id} className="grid gap-2 border-b px-3 py-2.5 last:border-b-0 md:grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_80px_140px] md:items-center md:gap-3">
                      <TaskStatus status={task.status} />
                      <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-medium">{task.providerName}</span><span className="truncate font-mono text-[10px] text-muted-foreground">{task.upstreamModelId}</span></div></div>
                      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground"><Icon size={13} className="shrink-0" /><span className="truncate">{PROTOCOL_LABELS[task.protocol]}</span></div>
                      <div className={cn('text-[10px] font-medium', task.status === 'success' && 'text-emerald-600', task.status === 'failed' && 'text-red-600', task.status === 'running' && 'text-primary')}>{task.status === 'queued' ? '等待' : task.status === 'running' ? '请求中' : task.status === 'success' ? '通过' : '失败'}</div>
                      <div className="text-[10px] text-muted-foreground md:text-right">{task.result?.statusCode ? `HTTP ${task.result.statusCode} · ` : ''}{task.result ? `${task.result.durationMilliseconds}ms` : '—'}{task.result?.success && <span className="ml-1 font-mono">↓{task.result.outputTokens ?? '—'}</span>}</div>
                      {task.errorMessage && <div className="col-span-full ml-9 wrap-break-word rounded-md bg-red-500/[0.07] px-2.5 py-2 font-mono text-[10px] text-red-600 dark:text-red-400">{task.errorMessage}</div>}
                    </div>
                  })}
                </div>
              ) : (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  <div className="mb-3 flex size-10 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground"><Cpu size={18} /></div>
                  <div className="text-xs font-medium">{enabledModels.length === 0 ? '没有可测试的模型绑定' : '当前范围没有测试任务'}</div>
                  <div className="mt-1.5 max-w-sm text-[11px] leading-5 text-muted-foreground">
                    {enabledModels.length === 0 ? '请先在模型管理中添加并启用上游模型，然后返回这里验证协议与渠道。' : '选择至少一个可用协议和渠道，测试任务会在这里列出。'}
                  </div>
                </div>
              )}
        </main>
      </DialogContent>
    </Dialog>
  )
}
