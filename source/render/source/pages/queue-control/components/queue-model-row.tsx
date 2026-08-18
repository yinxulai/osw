import { AlertTriangle, BotMessageSquare, CheckCircle2, Circle, CircleDot, Clock, GripVertical, MessageSquareCode, Sparkles, Timer, Zap } from 'lucide-react'
import type { Protocol, Provider, ProviderHealth, UpstreamModel } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { QueueModelMetrics } from '../lib/model-metrics'

interface QueueModelRowProps {
  model: UpstreamModel
  provider?: Provider
  providerHealth?: ProviderHealth
  metrics?: QueueModelMetrics
  mode: 'auto' | 'manual'
  selected: boolean
  cooling: boolean
  dragging: boolean
  dragHandleProps: Record<string, unknown>
  onSelect: () => void
  onToggleEnabled: (enabled: boolean) => void
}

const PROTOCOL_META: Record<Protocol, { label: string; icon: typeof MessageSquareCode }> = {
  'openai-completions': { label: 'OpenAI Completions', icon: MessageSquareCode },
  'openai-responses': { label: 'OpenAI Responses', icon: Sparkles },
  'anthropic-messages': { label: 'Anthropic Messages', icon: BotMessageSquare },
}

function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  const difference = Date.now() - timestamp
  if (difference < 60_000) return `${Math.floor(difference / 1000)} 秒前`
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`
  return `${Math.floor(difference / 86_400_000)} 天前`
}

function formatAverageTps(tps: number | null | undefined): string {
  if (tps == null) return '—'
  return tps >= 10 ? String(Math.round(tps)) : tps.toFixed(1)
}

function formatAverageTtft(milliseconds: number | null | undefined): string {
  if (milliseconds == null) return '—'
  return `${(milliseconds / 1000).toFixed(2)}s`
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
      <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-medium text-muted-foreground">
        {model.priority}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{props.provider?.name ?? '未知供应商'}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">{model.upstreamModelId}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <TooltipProvider delayDuration={150}>
            <span className="inline-flex items-center gap-1">
              {model.endpoints.map(endpoint => {
                const meta = PROTOCOL_META[endpoint.protocol]
                const ProtocolIcon = meta.icon
                return (
                  <Tooltip key={endpoint.protocol}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex size-5 items-center justify-center rounded border bg-background text-muted-foreground" aria-label={meta.label}>
                        <ProtocolIcon size={11} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{meta.label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </span>
          </TooltipProvider>
          <span className="inline-flex items-center gap-1" title={`最近 ${props.metrics?.sampleCount ?? 0} 个成功请求的平均输出速度`}>
            <Zap size={11} />
            TPS {formatAverageTps(props.metrics?.avgTps)}
          </span>
          <span className="inline-flex items-center gap-1" title={`最近 ${props.metrics?.sampleCount ?? 0} 个成功请求的平均首 Token 时间`}>
            <Timer size={11} />
            TTFT {formatAverageTtft(props.metrics?.avgTtftMilliseconds)}
          </span>
          {props.metrics && <span className="text-[10px] text-muted-foreground/70">近 {props.metrics.sampleCount} 次</span>}
          <ModelHealth providerHealth={props.providerHealth} />
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
