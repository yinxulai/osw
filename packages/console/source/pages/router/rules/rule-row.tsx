import type { ReactNode } from 'react'
import { ArrowRight, ChevronRight, Copy, GripVertical, MoreHorizontal, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { RouteRule } from '@common/router/route-rules'
import type { LogicalModel } from '@common/schemas'
import { PANEL_POPUP_ITEM_CLASSNAME, PANEL_POPUP_SURFACE_CLASSNAME } from '../panel/panel-fields'
import { builtinRouteRuleName } from './builtin-rule-name'
import { RuleEditorPanel } from './rule-editor-panel'
import { describeConditions, describeLanding } from './rule-summary'

interface RuleRowProps {
  rule: RouteRule
  index: number
  expanded: boolean
  logicalModels: LogicalModel[]
  autoFocusName: boolean
  onToggleExpand: () => void
  onChange: (patch: Partial<RouteRule>) => void
  onDuplicate: () => void
  onDelete: () => void
  onToggleEnabled: (enabled: boolean) => void
}

/**
 * 一条规则：一行读法 + （展开时）就地编辑。
 *
 * 行上只留「读这一条」需要的四样东西 —— 名称、条件、落点、启停；其余操作收进一个菜单。
 * 上一版把上移 / 下移 / 编辑 / 复制 / 删除五个图标并排摆在行尾，等于让「改顺序」有两种入口、
 * 让「删除」离「复制」只有一个图标的距离，行尾因此变成了整张表里最吵的地方。
 * 现在顺序只有拖拽一个入口（键盘走拖柄的 Space + 方向键），编辑靠点行展开，行尾只剩启停与菜单。
 */
export function SortableRuleRow(props: RuleRowProps) {
  const { rule } = props
  const t = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.id })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('border-b border-components-panel-border last:border-b-0', isDragging && 'relative z-10 bg-workflow-block-bg')}
    >
      <RuleRowBody
        {...props}
        dragging={isDragging}
        dragHandle={(
          <button
            type="button"
            aria-label={t('router.rules.dragAria')}
            className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-quaternary opacity-40 hover:bg-state-base-hover hover:text-text-secondary hover:opacity-100 active:cursor-grabbing group-hover:opacity-100"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
      />
    </li>
  )
}

interface RuleRowBodyProps extends RuleRowProps {
  dragging: boolean
  dragHandle: ReactNode
}

function RuleRowBody(props: RuleRowBodyProps) {
  const {
    rule, index, expanded, logicalModels, autoFocusName, dragging, dragHandle,
    onToggleExpand, onChange, onDuplicate, onDelete, onToggleEnabled,
  } = props
  const t = useTranslation()

  const landing = describeLanding(rule.landing, t, modelId => logicalModels.find(model => model.id === modelId)?.name ?? modelId)
  const landingEmpty = rule.landing.source === 'variable'
    ? rule.landing.variablePath.trim().length === 0
    : rule.landing.logicalModelIds.length === 0

  return (
    <div className={cn('group', dragging && 'opacity-80')}>
      <div className={cn('flex items-center gap-1.5 px-2 py-1.5', !rule.enabled && 'opacity-55')}>
        {dragHandle}

        <span className="w-5 shrink-0 text-right font-mono system-2xs-regular text-text-quaternary">{index + 1}</span>

        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? t('router.rules.collapseAria') : t('router.rules.expandAria')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-state-base-hover"
          onClick={onToggleExpand}
        >
          <ChevronRight
            className={cn('size-3.5 shrink-0 text-text-quaternary transition-transform', expanded && 'rotate-90')}
            aria-hidden
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate system-xs-medium text-text-primary">
                {builtinRouteRuleName(rule, t) || t('router.rules.unnamed')}
              </span>
              {/* 条数挨着规则名，而不是跟在条件句子后面。跟在后面时那条句子先被截断，
                  角标就成了「省略号 + 一个没有主语的数字」，而它想说的正是「后面还有两条」。 */}
              {rule.conditions.length > 1 && (
                <Badge variant="muted" className="shrink-0">{t('router.rules.conditionCount', { count: rule.conditions.length })}</Badge>
              )}
            </span>
            {/* 条件这一行允许折到两行：一条规则长什么样，全由这一行说；只给一行的话，
                串到第二个条件就被切掉，读到的是一条「开头正确、结尾是省略号」的规则。 */}
            <span className="line-clamp-2 system-2xs-regular text-text-tertiary">{describeConditions(rule, t)}</span>
          </span>
        </button>

        {/* 落点用一个箭头引出来：规则表里「条件 → 落点」就是唯一的动作，用逗号拼接会把这个方向丢掉。 */}
        <span className="flex max-w-56 shrink-0 items-center gap-1">
          <ArrowRight className="size-3.5 shrink-0 text-text-quaternary" aria-hidden />
          <span className={cn('truncate system-2xs-regular', landingEmpty ? 'text-text-warning' : 'text-text-secondary')}>
            {landing}
          </span>
        </span>

        <Switch checked={rule.enabled} aria-label={t('router.rules.enableAria')} onCheckedChange={onToggleEnabled} />

        <DropdownMenu>
          {/* 把按钮类名交给 Radix、让它渲染自己的 <button>：`Button` 是普通函数组件，
              `asChild` 下 Radix 拿不到真实 DOM 节点的 ref，浮层锚点也就落不到行尾这个按钮上。 */}
          <DropdownMenuTrigger
            aria-label={t('router.rules.moreAria')}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0 text-text-tertiary')}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(PANEL_POPUP_SURFACE_CLASSNAME, 'w-44')}>
            <DropdownMenuItem className={PANEL_POPUP_ITEM_CLASSNAME} onSelect={onDuplicate}>
              <Copy className="size-3.5" aria-hidden /> {t('router.rules.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-components-panel-border" />
            <DropdownMenuItem variant="destructive" className={PANEL_POPUP_ITEM_CLASSNAME} onSelect={onDelete}>
              <Trash2 className="size-3.5" aria-hidden /> {t('router.rules.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && (
        <RuleEditorPanel
          rule={rule}
          logicalModels={logicalModels}
          autoFocusName={autoFocusName}
          onChange={onChange}
        />
      )}
    </div>
  )
}
