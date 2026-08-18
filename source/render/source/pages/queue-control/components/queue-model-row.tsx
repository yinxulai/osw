import { AlertTriangle, CheckCircle, CheckCircle2, Circle, CircleDot, Clock, GripVertical, Timer, XCircle } from 'lucide-react'
import type { Provider, ProviderHealth, UpstreamModel } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { PROTOCOL_LABELS, type ProtocolTestResult } from './queue-test-report'

interface QueueModelRowProps {
  model: UpstreamModel
  provider?: Provider
  providerHealth?: ProviderHealth
  mode: 'auto' | 'manual'
  selected: boolean
  cooling: boolean
  dragging: boolean
  dragHandleProps: Record<string, unknown>
  testResults: ProtocolTestResult[] | null
  onSelect: () => void
  onToggleEnabled: (enabled: boolean) => void
}

interface ModelTestResultsProps {
  results: ProtocolTestResult[]
}

function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  const difference = Date.now() - timestamp
  if (difference < 60_000) return `${Math.floor(difference / 1000)} 秒前`
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`
  return `${Math.floor(difference / 86_400_000)} 天前`
}

function ModelHealth(props: Pick<QueueModelRowProps, 'providerHealth'>) {
  const failures = props.providerHealth?.consecutiveFailures ?? 0
  const lastSuccessTime = props.providerHealth?.lastSuccessTime

  if (failures > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
        <AlertTriangle size={11} />
        连续失败 {failures} 次
      </span>
    )
  }
  if (lastSuccessTime) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
        <CheckCircle2 size={11} />
        最后成功 {formatRelativeTime(lastSuccessTime)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Clock size={11} />
      暂无请求记录
    </span>
  )
}

function ModelTestResults(props: ModelTestResultsProps) {
  return props.results.map(result => (
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
}

export function QueueModelRow(props: QueueModelRowProps) {
  const { model } = props

  return (
    <div
      onClick={props.onSelect}
      className={cn(
        'flex items-center gap-2 border-l-2 border-l-transparent px-4 py-2.5',
        props.selected && 'border-l-primary bg-primary/5',
        props.mode === 'manual' && model.enabled && !props.cooling && 'cursor-pointer hover:bg-muted/40',
        props.dragging && 'bg-muted/60',
      )}
    >
      {props.mode === 'manual' ? (
        props.selected ? <CircleDot size={16} className="text-primary" /> : <Circle size={16} className="text-muted-foreground/40" />
      ) : (
        <button
          aria-label={`拖动 ${model.upstreamModelId}`}
          className="cursor-grab touch-none text-muted-foreground/50"
          {...props.dragHandleProps}
        >
          <GripVertical size={14} />
        </button>
      )}
      <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
        {model.priority}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold">{props.provider?.name ?? '未知供应商'}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">{model.upstreamModelId}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {model.endpoints.map(endpoint => (
              <Badge key={endpoint.protocol} variant="outline" className="h-4 px-1 text-[9px]">
                {endpoint.protocol.toUpperCase()}
              </Badge>
            ))}
          </span>
          {props.testResults ? <ModelTestResults results={props.testResults} /> : <ModelHealth providerHealth={props.providerHealth} />}
        </div>
      </div>
      <Badge variant={props.cooling ? 'destructive' : model.enabled ? 'success' : 'muted'}>
        {props.cooling ? '冷却中' : model.enabled ? (props.selected ? '当前指定' : '待命') : '已禁用'}
      </Badge>
      <Switch
        checked={model.enabled}
        onCheckedChange={props.onToggleEnabled}
        onClick={event => event.stopPropagation()}
        aria-label={`${model.upstreamModelId} 启用状态`}
      />
    </div>
  )
}
