import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  ChevronRight,
  GripVertical,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react'
import type { LogicalModelProviderModel, Provider, ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { formatMilliseconds, formatOutputSpeed } from '@common/metrics'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProtocolIcons } from '@/components/protocol-icons'
import { Switch } from '@/components/ui/switch'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import { routePaths } from '@/routing/routes'
import { cn } from '@/lib/utils'
import type { ProviderModelMetrics } from '../lib/model-metrics'

interface ProviderModelRowProps {
  model: LogicalModelProviderModel
  provider?: Provider
  providerHealth?: ProviderHealth
  providerModelHealth?: ProviderModelHealth
  metrics?: ProviderModelMetrics
  mode: 'auto' | 'manual'
  selected: boolean
  cooling: boolean
  dragging: boolean
  dragHandleProps: Record<string, unknown>
  onSelect: () => void
  onToggleEnabled: (enabled: boolean) => void
  onRemove: () => void
}

type HealthSource = 'model' | 'provider-fallback' | 'none'

export interface ProviderModelHealthDisplay {
  source: HealthSource
  consecutiveFailures: number
  lastSuccessTime: number | null
}

function formatRelativeTime(t: AppTranslator, timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  const difference = Date.now() - timestamp
  if (difference < 60_000) return t('logicalModels.row.secondsAgo', { count: Math.floor(difference / 1000) })
  if (difference < 3_600_000) return t('logicalModels.row.minutesAgo', { count: Math.floor(difference / 60_000) })
  if (difference < 86_400_000) return t('logicalModels.row.hoursAgo', { count: Math.floor(difference / 3_600_000) })
  return t('logicalModels.row.daysAgo', { count: Math.floor(difference / 86_400_000) })
}

function hasHealthSignal(health: ProviderHealth | ProviderModelHealth | undefined): boolean {
  if (!health) return false
  return Boolean(
    health.consecutiveFailures > 0
    || health.lastSuccessTime
    || health.lastFailureTime
    || health.cooldownUntilTime,
  )
}

export function resolveProviderModelHealthDisplay(props: Pick<ProviderModelRowProps, 'providerHealth' | 'providerModelHealth'>): ProviderModelHealthDisplay {
  if (hasHealthSignal(props.providerModelHealth)) {
    return {
      source: 'model',
      consecutiveFailures: props.providerModelHealth?.consecutiveFailures ?? 0,
      lastSuccessTime: props.providerModelHealth?.lastSuccessTime ?? null,
    }
  }

  if (hasHealthSignal(props.providerHealth)) {
    return {
      source: 'provider-fallback',
      consecutiveFailures: props.providerHealth?.consecutiveFailures ?? 0,
      lastSuccessTime: props.providerHealth?.lastSuccessTime ?? null,
    }
  }

  return {
    source: 'none',
    consecutiveFailures: 0,
    lastSuccessTime: null,
  }
}

function ModelHealth(props: Pick<ProviderModelRowProps, 'providerHealth' | 'providerModelHealth'>) {
  const t = useTranslation()
  const healthDisplay = resolveProviderModelHealthDisplay(props)
  const failures = healthDisplay.consecutiveFailures
  const lastSuccessTime = healthDisplay.lastSuccessTime
  const isProviderFallback = healthDisplay.source === 'provider-fallback'

  if (failures > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-text-warning">
        <AlertTriangle size={11} aria-hidden />
        {isProviderFallback ? t('logicalModels.row.providerFailures', { count: failures }) : t('logicalModels.row.modelFailures', { count: failures })}
      </span>
    )
  }
  if (lastSuccessTime) {
    return (
      <span className="inline-flex items-center gap-1 text-text-success">
        <CheckCircle2 size={11} aria-hidden />
        {isProviderFallback ? t('logicalModels.row.providerLastSuccess', { time: formatRelativeTime(t, lastSuccessTime) }) : t('logicalModels.row.modelLastSuccess', { time: formatRelativeTime(t, lastSuccessTime) })}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Clock size={11} aria-hidden />
      {t('logicalModels.row.noRequests')}
    </span>
  )
}

export function ProviderModelRow(props: ProviderModelRowProps) {
  const { model } = props
  const t = useTranslation()

  return (
    <div
      onClick={props.onSelect}
      className={cn(
        'group/row relative flex min-h-14 min-w-88 items-center gap-2 overflow-hidden border-b border-border/50 border-l-2 border-l-transparent px-3 py-2 last:border-b-0 transition-colors hover:bg-state-base-hover',
        props.selected && 'border-l-primary bg-accent',
        props.mode === 'manual' && 'cursor-pointer',
        props.dragging && 'bg-state-base-hover-alt',
      )}
    >
      <div className="min-w-0 flex-1">
        {/* 手柄静止时宽度收成 0（图标被裁掉），浮入这一行才撑开，所以不显示时它完全不占位置。
            它必须留在「供应商 · 模型名」这一行里：与文字各自居中于同一条行盒才必然对齐；
            拆到左边单独一列，它会按两行文字的整体高度居中，图标比文字低半行。 */}
        <div className="flex min-w-0 items-center system-xs-medium">
          <div
            className={cn(
              'flex h-5 w-0 shrink-0 items-center justify-center overflow-hidden rounded-sm text-text-quaternary transition-[width,color] hover:text-text-primary focus-visible:w-6.5 focus-visible:text-text-primary focus-visible:outline-none',
              // 故障转移下只在浮入这一行（或正在拖动）时才露出手柄：否则列表左边是一整排抓取图标。
              props.mode === 'auto' && 'cursor-grab touch-none select-none active:cursor-grabbing',
              // 手动指定的圆点要一直看得见；故障转移下手柄只在浮入或拖动时撑开（20px + 6px 间距）。
              props.mode !== 'auto' || props.dragging ? 'w-6.5' : 'group-hover/row:w-6.5',
            )}
            {...(props.mode === 'auto' ? props.dragHandleProps : {})}
            aria-label={props.mode === 'auto' ? t('logicalModels.row.dragAria', { model: model.modelName }) : undefined}
          >
            {props.mode === 'manual' ? (
              props.selected ? <CircleDot size={16} className="text-primary" /> : <Circle size={16} className="text-text-quaternary" />
            ) : (
              <GripVertical size={16} />
            )}
          </div>
          {props.provider ? (
            <Link
              to={routePaths.overviewProvider}
              params={{ providerId: model.providerId }}
              search={{ range: '7d' }}
              className="group/provider inline-flex min-w-0 items-center gap-0.5 rounded-sm text-left text-text-primary outline-none transition-colors hover:text-primary focus-visible:bg-accent focus-visible:text-primary"
              title={t('logicalModels.row.viewAnalytics', { provider: props.provider.name })}
              aria-label={t('logicalModels.row.viewAnalytics', { provider: props.provider.name })}
              // 行本身可选/可拖：点击链接不能顺带把行也选中。
              onClick={event => event.stopPropagation()}
            >
              <span className="min-w-0 truncate">{props.provider.name}</span>
              <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
              <span className="min-w-0 truncate font-mono text-text-primary">{model.modelName}</span>
              <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-text-quaternary transition-transform group-hover/provider:translate-x-0.5 group-hover/provider:text-primary group-focus-visible/provider:text-primary" />
            </Link>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 truncate text-text-primary">{t('logicalModels.row.unknownProvider')}</div>
              <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
              <div className="min-w-0 truncate font-mono text-text-primary">{model.modelName}</div>
            </div>
          )}
        </div>
        {/* 指标行与「供应商 · 模型名」同一起点：手柄撑开多宽（26px）这里就补多少内边距，
            过渡与手柄同速，于是手柄收起时两行都贴左、浮入时两行一起右移。 */}
        <div className={cn(
          'mt-1 flex min-w-0 items-center gap-2 system-2xs-regular text-text-tertiary transition-[padding]',
          props.mode !== 'auto' || props.dragging ? 'pl-6.5' : 'group-hover/row:pl-6.5',
        )}>
          <ProtocolIcons endpoints={model.endpoints} />
          <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1"><Zap size={10} aria-hidden />TPS {formatOutputSpeed(props.metrics?.avgTps)}</span>
          <span className="inline-flex items-center gap-1"><Timer size={10} aria-hidden />TTFT {formatMilliseconds(props.metrics?.avgTtftMilliseconds)}</span>
          {/* 模型本体被停用时，健康度已经没有意义（它永远不会被调度），这里换成「为什么不能开」。 */}
          {model.modelEnabled
            ? <ModelHealth providerHealth={props.providerHealth} providerModelHealth={props.providerModelHealth} />
            : (
              <span className="inline-flex min-w-0 items-center gap-1 text-text-quaternary" title={t('logicalModels.row.modelDisabledHint')}>
                <Ban size={11} aria-hidden className="shrink-0" />
                <span className="truncate">{t('logicalModels.row.modelDisabledHint')}</span>
              </span>
            )}
        </div>
      </div>
      <div className="flex min-w-20 shrink-0 items-center justify-end">
        <Badge variant={!model.modelEnabled ? 'muted' : props.cooling ? 'destructive' : model.enabled ? 'success' : 'muted'}>{!model.modelEnabled ? t('logicalModels.row.modelDisabled') : props.cooling ? t('logicalModels.row.cooling') : model.enabled ? (props.selected ? t('logicalModels.row.selected') : t('logicalModels.row.standby')) : t('common.state.disabled')}</Badge>
      </div>
      {/* 操作直接落在一条模糊的遮罩上，而不是滑进来一张带边框的小白卡片：
          遮罩铺满整行高度、左缘渐变淡出，被盖住的指标与徽标只是在模糊里淡出，没有新的卡片边界。 */}
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 bg-linear-to-l from-components-panel-bg-blur from-55% to-transparent pl-10 pr-3 opacity-0 backdrop-blur-[5px] transition-opacity',
          'group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        )}
      >
        {/* 模型本体被全局停用时，绑定开关置灰：打开的绑定不会被调度（`getAvailableModels`
            要求模型本体也是启用的），所以这里不能只画成「待命」。 */}
        <Switch
          checked={model.enabled}
          disabled={!model.modelEnabled}
          onCheckedChange={props.onToggleEnabled}
          onClick={event => event.stopPropagation()}
          aria-label={model.modelEnabled ? t('logicalModels.row.enabledState', { model: model.modelName }) : t('logicalModels.row.modelDisabledHint')}
          title={model.modelEnabled ? undefined : t('logicalModels.row.modelDisabledHint')}
        />
        <Button variant="ghost" size="icon-sm" onClick={event => { event.stopPropagation(); props.onRemove() }} aria-label={t('logicalModels.row.removeAria', { model: model.modelName })} title={t('logicalModels.row.removeTitle')}><Trash2 size={16} /></Button>
      </div>
    </div>
  )
}
