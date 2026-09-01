import { ChevronRight, GripVertical, Layers } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { tableRowClass } from '@/components/table-primitives'
import { ProviderIcon } from '@/pages/model-management/components/provider-icon'
import type { ProviderModelRoute } from '@common/schemas'

interface QueueGroupHeaderProps {
  providerName: string
  models: ProviderModelRoute[]
  collapsed: boolean
  mode: 'auto' | 'manual'
  dragging: boolean
  dragHandleProps: Record<string, unknown>
  onToggleCollapsed: () => void
}

export function QueueGroupHeader(props: QueueGroupHeaderProps) {
  const { models, mode } = props
  const enabledCount = models.filter(model => model.enabled).length
  const firstPriority = models.reduce((min, model) => Math.min(min, model.priority), Number.POSITIVE_INFINITY)

  return (
    <div
      className={cn(
        'grid min-h-12 min-w-xl grid-cols-[4rem_minmax(14rem,1.4fr)_minmax(9rem,1fr)_7.5rem] items-center gap-x-0 bg-muted/50 px-4 py-2 lg:min-w-176 lg:grid-cols-[4rem_minmax(14rem,1.4fr)_minmax(9rem,1fr)_minmax(8rem,.9fr)_7.5rem]',
        tableRowClass,
        props.dragging && 'rounded-md bg-primary/5',
      )}
    >
      <div className="flex items-center gap-1 px-1.5">
        <button
          type="button"
          onClick={props.onToggleCollapsed}
          aria-label={props.collapsed ? `展开 ${props.providerName}` : `收起 ${props.providerName}`}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight size={15} className={cn('transition-transform', !props.collapsed && 'rotate-90')} />
        </button>
        {mode === 'auto' ? (
          <span
            className="flex h-6 w-6 cursor-grab touch-none select-none items-center justify-center rounded-sm text-muted-foreground/70 active:cursor-grabbing"
            {...props.dragHandleProps}
            aria-label={`拖动分组 ${props.providerName}`}
          >
            <GripVertical size={15} />
          </span>
        ) : (
          <span className="flex h-6 w-6 items-center justify-center text-muted-foreground/50">
            <Layers size={14} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ color: 'var(--primary)', backgroundColor: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}
        >
          <ProviderIcon name={props.providerName} size={18} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold">{props.providerName}</span>
            <Badge variant="muted" className="text-[10px]">{models.length} 个模型</Badge>
          </div>
          <div className="text-[10.5px] text-muted-foreground">免费模型分组 · 整组拖动调整优先级</div>
        </div>
      </div>

      <div className="hidden text-[11px] text-muted-foreground lg:block">
        {Number.isFinite(firstPriority) ? `起始优先级 #${firstPriority}` : ''}
      </div>
      <div className="hidden lg:block" />

      <div className="flex items-center justify-end">
        <Badge variant={enabledCount > 0 ? 'success' : 'muted'}>
          {enabledCount > 0 ? `${enabledCount} 个待命` : '已禁用'}
        </Badge>
      </div>
    </div>
  )
}
