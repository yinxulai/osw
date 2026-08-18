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
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useState } from 'react'
import { Circle, CircleDot, GripVertical, RefreshCw, Target, Clock, AlertTriangle, CheckCircle2, Loader2, CheckCircle, XCircle, FlaskConical, Timer, Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { SortableBinding } from './sortable-binding'
import { modelTestApi, type ModelTestResult } from '@/api'
import type { UpstreamModel, Provider, ProviderHealth, Protocol } from '@common/schemas'

export type ProviderMap = Record<string, Provider>
export type HealthMap = Record<string, ProviderHealth>

interface QueueListCardProps {
  models: UpstreamModel[]
  providers: ProviderMap
  health: HealthMap
  logicalModelId?: string
  logicalModelName?: string
  mode: 'auto' | 'manual'
  manualModelId: string
  isCooling: (providerId: string) => boolean
  onModeChange: (mode: 'auto' | 'manual') => void
  onSelectManualModel: (model: UpstreamModel) => void
  onToggleEnabled: (model: UpstreamModel, enabled: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
}

function formatRelativeTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

const PROTOCOL_LABELS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic',
}

export function QueueListCard(props: QueueListCardProps) {
  const {
    models,
    providers,
    health,
    logicalModelId,
    logicalModelName,
    mode,
    manualModelId,
    isCooling,
    onModeChange,
    onSelectManualModel,
    onToggleEnabled,
    onDragEnd,
  } = props

  const [testProtocol, setTestProtocol] = useState<Protocol | 'all'>('all')
  const [testRunning, setTestRunning] = useState(false)
  const [testResults, setTestResults] = useState<Partial<Record<Protocol, ModelTestResult[]>> | null>(null)

  const availableProtocols = Array.from(
    new Set(models.flatMap(m => m.endpoints.map(e => e.protocol))),
  ) as Protocol[]

  const handleRunTest = async () => {
    if (!logicalModelId || testRunning) return
    setTestRunning(true)
    setTestResults(null)
    try {
      const protocols = testProtocol === 'all' ? availableProtocols : [testProtocol]
      const responses = await Promise.all(protocols.map(protocol => modelTestApi.run(logicalModelId, protocol)))
      const nextResults: Partial<Record<Protocol, ModelTestResult[]>> = {}
      responses.forEach((response, index) => {
        if (response.success) nextResults[protocols[index]] = response.data.results
      })
      setTestResults(nextResults)
    } finally {
      setTestRunning(false)
    }
  }

  const allTestResults = testResults
    ? Object.entries(testResults).flatMap(([protocol, results]) =>
        (results ?? []).map(result => ({ ...result, protocol: protocol as Protocol })),
      )
    : []
  const getTestResults = (modelId: string) => allTestResults.filter(result => result.modelId === modelId)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <Card>
      <CardHeader className="gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <CardTitle>优先级队列</CardTitle>
          <CardDescription className="mt-1">
            队列 {logicalModelName ?? '尚未配置'}，拖拽后立即生效
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={mode} onValueChange={value => onModeChange(value as 'auto' | 'manual')}>
            <TabsList className="h-7">
              <TabsTrigger value="auto" className="h-6 px-2.5 text-[11px]">
                <RefreshCw size={12} /> 自动转移
              </TabsTrigger>
              <TabsTrigger value="manual" className="h-6 px-2.5 text-[11px]">
                <Target size={12} /> 手动指定
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {availableProtocols.length > 0 && (
            <div className="flex items-center overflow-hidden rounded-md border bg-background shadow-sm">
              <Select value={testProtocol} onValueChange={value => setTestProtocol(value as Protocol | 'all')}>
                <SelectTrigger className="h-8 w-36 rounded-none border-0 border-r bg-muted/20 text-[11px] shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部协议</SelectItem>
                  {availableProtocols.map(protocol => (
                    <SelectItem key={protocol} value={protocol}>{PROTOCOL_LABELS[protocol]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-none px-3 text-[11px]"
                onClick={() => void handleRunTest()}
                disabled={testRunning || !logicalModelId}
              >
                {testRunning ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
                {testRunning ? '探测中' : '运行探测'}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* 测试结果汇总 */}
        {testResults && (
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 rounded-lg border bg-muted/20 px-3 py-2.5 text-[11px]">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-medium">
                <Activity size={12} className="text-primary" />
                队列连通性报告
              </div>
              <div className="mt-0.5 truncate text-muted-foreground">
                已探测 {Object.keys(testResults).length} 个协议、{allTestResults.length} 个可用绑定
              </div>
            </div>
            <div className="text-center">
              <div className="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">{allTestResults.filter(result => result.success).length}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">成功</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">{allTestResults.filter(result => !result.success).length}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">失败</div>
            </div>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setTestResults(null)}>关闭</button>
          </div>
        )}

        {models.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={event => void onDragEnd(event)}
          >
            <SortableContext items={models.map(model => model.id)} strategy={verticalListSortingStrategy}>
              <div className="-mx-4 -mb-4 overflow-hidden rounded-b-lg divide-y border-t">
                {models.map(model => {
                  const provider = providers[model.providerId]
                  const providerHealth = health[model.providerId]
                  const cooling = isCooling(model.providerId)
                  const selected = mode === 'manual' && manualModelId === model.id
                  const consecutiveFailures = providerHealth?.consecutiveFailures ?? 0
                  const lastSuccessTime = providerHealth?.lastSuccessTime
                  return (
                    <SortableBinding key={model.id} id={model.id}>
                      {(handleProps, dragging) => (
                        <div
                          onClick={() => void onSelectManualModel(model)}
                          className={cn(
                            'flex items-center gap-2 border-l-2 border-l-transparent px-4 py-2.5',
                            selected && 'border-l-primary bg-primary/5',
                            mode === 'manual' && model.enabled && !cooling && 'cursor-pointer hover:bg-muted/40',
                            dragging && 'bg-muted/60',
                          )}
                        >
                          {mode === 'manual' ? (
                            selected ? (
                              <CircleDot size={16} className="text-primary" />
                            ) : (
                              <Circle size={16} className="text-muted-foreground/40" />
                            )
                          ) : (
                            <button
                              aria-label={`拖动 ${model.upstreamModelId}`}
                              className="cursor-grab touch-none text-muted-foreground/50"
                              {...handleProps}
                            >
                              <GripVertical size={14} />
                            </button>
                          )}
                          <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
                            {model.priority}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold">
                                {provider?.name ?? '未知供应商'}
                              </span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {model.upstreamModelId}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                {model.endpoints.map(endpoint => (
                                  <Badge key={endpoint.protocol} variant="outline" className="h-4 px-1 text-[9px]">
                                    {endpoint.protocol.toUpperCase()}
                                  </Badge>
                                ))}
                              </span>
                              {testResults ? (
                                getTestResults(model.id).map(result => (
                                  <span
                                    key={result.protocol}
                                    className={cn(
                                      'inline-flex items-center gap-1 rounded border px-1.5 py-0.5',
                                      result.success
                                        ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                                        : 'border-red-500/25 bg-red-500/5 text-red-600 dark:text-red-400',
                                    )}
                                    title={result.errorMessage}
                                  >
                                    {result.success ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                    {PROTOCOL_LABELS[result.protocol]}
                                    {result.statusCode && <span className="font-mono">HTTP {result.statusCode}</span>}
                                    <Timer size={10} />
                                    <span className="font-mono">{result.durationMilliseconds}ms</span>
                                    {result.success && (result.inputTokens != null || result.outputTokens != null) && (
                                      <span className="font-mono opacity-75">↑{result.inputTokens ?? '—'} ↓{result.outputTokens ?? '—'}</span>
                                    )}
                                    {!result.success && <span className="max-w-48 truncate">{result.errorMessage ?? '未知错误'}</span>}
                                  </span>
                                ))
                              ) : (
                                <>
                                  {consecutiveFailures > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                                      <AlertTriangle size={11} />
                                      连续失败 {consecutiveFailures} 次
                                    </span>
                                  ) : lastSuccessTime ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
                                      <CheckCircle2 size={11} />
                                      最后成功 {formatRelativeTime(lastSuccessTime)}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1">
                                      <Clock size={11} />
                                      暂无请求记录
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          <Badge variant={cooling ? 'destructive' : model.enabled ? 'success' : 'muted'}>
                            {cooling ? '冷却中' : model.enabled ? (selected ? '当前指定' : '待命') : '已禁用'}
                          </Badge>
                          <Switch
                            checked={model.enabled}
                            onCheckedChange={enabled => void onToggleEnabled(model, enabled)}
                            onClick={event => event.stopPropagation()}
                            aria-label={`${model.upstreamModelId} 启用状态`}
                          />
                        </div>
                      )}
                    </SortableBinding>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="-mx-4 -mb-4 flex min-h-40 items-center justify-center border-t text-xs text-muted-foreground">
            请先在模型管理中添加上游模型。
          </div>
        )}
      </CardContent>
    </Card>
  )
}
