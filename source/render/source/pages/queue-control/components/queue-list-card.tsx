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
import { Circle, CircleDot, GripVertical, RefreshCw, Target, Clock, AlertTriangle, CheckCircle2, Loader2, ChevronDown, CheckCircle, XCircle, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

  const [testProtocol, setTestProtocol] = useState<Protocol>('openai-completions')
  const [testRunning, setTestRunning] = useState(false)
  const [testResults, setTestResults] = useState<ModelTestResult[] | null>(null)
  const [showProtocolMenu, setShowProtocolMenu] = useState(false)

  const availableProtocols = Array.from(
    new Set(models.flatMap(m => m.endpoints.map(e => e.protocol))),
  ) as Protocol[]

  const handleRunTest = async () => {
    if (!logicalModelId || testRunning) return
    setTestRunning(true)
    setTestResults(null)
    try {
      const result = await modelTestApi.run(logicalModelId, testProtocol)
      if (result.success) {
        setTestResults(result.data.results)
      }
    } finally {
      setTestRunning(false)
    }
  }

  const getTestResult = (modelId: string) =>
    testResults?.find(r => r.modelId === modelId)

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
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRunTest()}
                disabled={testRunning || !logicalModelId}
              >
                {testRunning ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                测试
                <div
                  className="group relative"
                  onClick={e => {
                    e.stopPropagation()
                    setShowProtocolMenu(v => !v)
                  }}
                >
                  <ChevronDown size={12} className="opacity-60" />
                  {showProtocolMenu && (
                    <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-md border bg-popover p-1 shadow-md">
                      {availableProtocols.map(protocol => (
                        <button
                          key={protocol}
                          className={cn(
                            'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] hover:bg-accent',
                            testProtocol === protocol && 'bg-accent/60',
                          )}
                          onClick={e => {
                            e.stopPropagation()
                            setTestProtocol(protocol)
                            setShowProtocolMenu(false)
                          }}
                        >
                          <span>{PROTOCOL_LABELS[protocol]}</span>
                          {testProtocol === protocol && (
                            <CheckCircle size={11} className="text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* 测试结果汇总 */}
        {testResults && testResults.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
              <Zap size={12} />
              {PROTOCOL_LABELS[testProtocol]} 测试完成
            </span>
            <span className="text-emerald-600 dark:text-emerald-500">
              <CheckCircle size={11} className="mr-1 inline" />
              成功 {testResults.filter(r => r.success).length}
            </span>
            <span className="text-red-600 dark:text-red-500">
              <XCircle size={11} className="mr-1 inline" />
              失败 {testResults.filter(r => !r.success).length}
            </span>
            <button
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setTestResults(null)}
            >
              关闭
            </button>
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
                              {(() => {
                                const tr = getTestResult(model.id)
                                if (tr) {
                                  return tr.success ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500" title={`测试成功 · ${tr.durationMilliseconds}ms${tr.inputTokens ? ` · 输入 ${tr.inputTokens}` : ''}${tr.outputTokens ? ` · 输出 ${tr.outputTokens}` : ''}`}>
                                      <CheckCircle size={11} />
                                      测试通过 · {tr.durationMilliseconds}ms
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-500" title={tr.errorMessage}>
                                      <XCircle size={11} />
                                      测试失败 · {tr.errorMessage ?? '未知错误'}
                                    </span>
                                  )
                                }
                                return null
                              })()}
                              {!testResults && (
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
