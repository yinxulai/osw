import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, Circle, FlaskConical, Loader2, Play, RotateCcw, Server, XCircle } from 'lucide-react'
import type { LogicalModel, Protocol, Provider, UpstreamModel } from '@common/schemas'
import { modelTestApi, type ModelTestResult } from '@/api'
import { Badge } from '@/components/ui/badge'
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
  'openai-completions': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}

const TEST_CONCURRENCY = 3

interface SelectionButtonProps {
  selected: boolean
  label: string
  description?: string
  onClick: () => void
}

function SelectionButton(props: SelectionButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
        props.selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-background hover:bg-muted/40',
      )}
      onClick={props.onClick}
    >
      <span className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border',
        props.selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
      )}>
        {props.selected && <Check size={11} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{props.label}</span>
        {props.description && <span className="block truncate text-[10px] text-muted-foreground">{props.description}</span>}
      </span>
    </button>
  )
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
  }, [props.open])

  const plannedTasks = useMemo<TestTask[]>(() => enabledModels.flatMap(model => {
    if (!selectedProviderIds.has(model.providerId)) return []
    const provider = props.providers.find(item => item.id === model.providerId)
    if (!provider) return []
    return model.endpoints
      .filter(endpoint => selectedProtocols.has(endpoint.protocol))
      .map(endpoint => ({
        id: `${model.id}:${endpoint.protocol}`,
        modelId: model.id,
        upstreamModelId: model.upstreamModelId,
        providerId: provider.id,
        providerName: provider.name,
        protocol: endpoint.protocol,
        status: 'queued',
      }))
  }), [enabledModels, props.providers, selectedProtocols, selectedProviderIds])

  const completedCount = tasks.filter(task => task.status === 'success' || task.status === 'failed').length
  const successCount = tasks.filter(task => task.status === 'success').length
  const failureCount = tasks.filter(task => task.status === 'failed').length
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100)

  const toggleProtocol = (protocol: Protocol) => {
    if (running) return
    setSelectedProtocols(current => {
      const next = new Set(current)
      if (next.has(protocol)) next.delete(protocol)
      else next.add(protocol)
      return next
    })
    setTasks([])
  }

  const toggleProvider = (providerId: string) => {
    if (running) return
    setSelectedProviderIds(current => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
    setTasks([])
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
      <DialogContent className="flex max-h-[88vh] max-w-5xl grid-rows-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FlaskConical size={16} className="text-primary" />
            全局渠道测试
          </DialogTitle>
          <DialogDescription className="text-xs">
            选择协议与渠道，对每个可用模型绑定发起真实小流量请求；并发上限 {TEST_CONCURRENCY}。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[290px_minmax(0,1fr)]">
          <aside className="overflow-auto border-r bg-muted/10 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold">协议</span>
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground"
                disabled={running}
                onClick={() => setSelectedProtocols(selectedProtocols.size === availableProtocols.length ? new Set() : new Set(availableProtocols))}
              >
                {selectedProtocols.size === availableProtocols.length ? '清空' : '全选'}
              </button>
            </div>
            <div className="space-y-1.5">
              {availableProtocols.map(protocol => (
                <SelectionButton
                  key={protocol}
                  selected={selectedProtocols.has(protocol)}
                  label={PROTOCOL_LABELS[protocol]}
                  onClick={() => toggleProtocol(protocol)}
                />
              ))}
            </div>

            <div className="mb-2 mt-5 flex items-center justify-between">
              <span className="text-xs font-semibold">渠道</span>
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground"
                disabled={running}
                onClick={() => setSelectedProviderIds(selectedProviderIds.size === availableProviders.length ? new Set() : new Set(availableProviders.map(provider => provider.id)))}
              >
                {selectedProviderIds.size === availableProviders.length ? '清空' : '全选'}
              </button>
            </div>
            <div className="space-y-1.5">
              {availableProviders.map(provider => {
                const modelCount = enabledModels.filter(model => model.providerId === provider.id).length
                return (
                  <SelectionButton
                    key={provider.id}
                    selected={selectedProviderIds.has(provider.id)}
                    label={provider.name}
                    description={`${modelCount} 个已启用模型`}
                    onClick={() => toggleProvider(provider.id)}
                  />
                )
              })}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col">
            <div className="border-b px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold">测试任务</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {running || tasks.length > 0
                      ? `${completedCount}/${tasks.length} 已完成`
                      : `将创建 ${plannedTasks.length} 个模型协议任务`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {tasks.length > 0 && !running && (
                    <Button variant="outline" size="sm" onClick={() => setTasks([])}>
                      <RotateCcw size={12} /> 重置
                    </Button>
                  )}
                  <Button size="sm" disabled={!props.logicalModel || plannedTasks.length === 0 || running} onClick={() => void runTests()}>
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {running ? '测试进行中' : `开始测试 (${plannedTasks.length})`}
                  </Button>
                </div>
              </div>
              {(running || tasks.length > 0) && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                    <span>{progress}%</span>
                    <span className="text-emerald-600">成功 {successCount}</span>
                    <span className="text-red-600">失败 {failureCount}</span>
                    {running && <span>并发 {Math.min(TEST_CONCURRENCY, tasks.length - completedCount)}</span>}
                  </div>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {(tasks.length > 0 ? tasks : plannedTasks).length > 0 ? (
                <div className="divide-y overflow-hidden rounded-lg border">
                  {(tasks.length > 0 ? tasks : plannedTasks).map(task => (
                    <div key={task.id} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-xs">
                      <div className="pt-0.5">
                        {task.status === 'running' ? <Loader2 size={14} className="animate-spin text-primary" />
                          : task.status === 'success' ? <CheckCircle2 size={14} className="text-emerald-600" />
                            : task.status === 'failed' ? <XCircle size={14} className="text-red-600" />
                              : <Circle size={14} className="text-muted-foreground/40" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{task.providerName}</span>
                          <span className="truncate font-mono text-[11px] text-muted-foreground">{task.upstreamModelId}</span>
                          <Badge variant="outline" className="h-5 px-1.5 text-[9px]">{PROTOCOL_LABELS[task.protocol]}</Badge>
                        </div>
                        {task.errorMessage && <div className="mt-1 break-all text-[11px] text-red-600 dark:text-red-400">{task.errorMessage}</div>}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                        {task.result?.statusCode && <span>HTTP {task.result.statusCode}</span>}
                        {task.result && <span>{task.result.durationMilliseconds}ms</span>}
                        {task.result?.success && <span>↑{task.result.inputTokens ?? '—'} ↓{task.result.outputTokens ?? '—'}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                  <Server size={24} className="opacity-40" />
                  请选择至少一个协议和一个渠道
                </div>
              )}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}
