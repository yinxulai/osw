import { ChevronRight, ListOrdered, Plus } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { MAX_ROUTE_RULES, type RouteRule, type RouteRuleSet } from '@common/router/route-rules'
import type { LogicalModel } from '@common/schemas'
import { LogicalModelPicker } from './landing-editor'
import { SortableRuleRow } from './rule-row'
import { describeLanding } from './rule-summary'

interface RulesListProps {
  ruleSet: RouteRuleSet
  logicalModels: LogicalModel[]
  /** 展开着的规则 id；同时只展开一条 —— 全展开等于没有列表 */
  expandedRuleId: string | null
  fallbackExpanded: boolean
  /** 刚建出来、还没填过名字的那条规则 */
  freshRuleId: string | null
  onCreate: () => void
  onToggleExpandRule: (ruleId: string | null) => void
  onToggleFallback: () => void
  onPatchRule: (ruleId: string, patch: Partial<RouteRule>) => void
  onDuplicate: (ruleId: string) => void
  onDelete: (ruleId: string) => void
  onToggleEnabled: (ruleId: string, enabled: boolean) => void
  onToggleFallbackModel: (modelId: string, checked: boolean) => void
}

/**
 * 顺序规则表。
 *
 * 顺序是这张表唯一的控制流，所以它必须**直接可改**：拖动行即改顺序，而不是把顺序藏进某个
 * 「优先级」字段里让人手填数字 —— 那样每次插入都要重排一遍数字。表级兜底固定排在所有规则之后，
 * 它没有条件可配、不能拖动、不能停用，所以它长得像一行但不是一行：同样的读法、同样的展开编辑，
 * 只是明确排在最后。上一版把它画成一行填满「—」的表格行，读起来像「一条没配好的规则」，
 * 而它其实是「所有规则都不命中时的去处」。
 */
export function RulesList(props: RulesListProps) {
  const {
    ruleSet, logicalModels, expandedRuleId, fallbackExpanded, freshRuleId,
    onCreate, onToggleExpandRule, onToggleFallback, onPatchRule, onDuplicate, onDelete,
    onToggleEnabled, onToggleFallbackModel,
  } = props
  const t = useTranslation()

  const atLimit = ruleSet.rules.length >= MAX_ROUTE_RULES
  const fallbackLanding = describeLanding({ source: 'fixed', logicalModelIds: ruleSet.fallbackModelIds, variablePath: '' }, t)

  return (
    <Card className="w-full gap-0 overflow-hidden py-0 ring-0">
      {/* 表头只报数：「新增规则」是页头的动作，这里再摆一个就等于同屏两个同名按钮。 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-components-panel-border px-3 py-2">
        <span className="system-xs-regular text-text-tertiary">
          {atLimit
            ? t('router.rules.limitReached', { count: MAX_ROUTE_RULES })
            : t('router.rules.count', { count: ruleSet.rules.length })}
        </span>
        <span className="system-2xs-regular text-text-quaternary">{t('router.rules.reorderHint')}</span>
      </div>

      {ruleSet.rules.length === 0
        ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
            <ListOrdered className="size-6 text-text-quaternary" aria-hidden />
            <span className="mt-1 system-sm-medium text-text-secondary">{t('router.rules.empty.title')}</span>
            <span className="max-w-96 system-xs-regular text-text-tertiary">{t('router.rules.empty.description')}</span>
            <Button type="button" size="sm" className="mt-2" onClick={onCreate}>
              <Plus className="size-3.5" aria-hidden /> {t('router.rules.add')}
            </Button>
          </div>
        )
        : (
          <SortableContext items={ruleSet.rules.map(rule => rule.id)} strategy={verticalListSortingStrategy}>
            <ul>
              {ruleSet.rules.map((rule, index) => (
                <SortableRuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  expanded={expandedRuleId === rule.id}
                  logicalModels={logicalModels}
                  autoFocusName={freshRuleId === rule.id}
                  onToggleExpand={() => onToggleExpandRule(expandedRuleId === rule.id ? null : rule.id)}
                  onChange={patch => onPatchRule(rule.id, patch)}
                  onDuplicate={() => onDuplicate(rule.id)}
                  onDelete={() => onDelete(rule.id)}
                  onToggleEnabled={enabled => onToggleEnabled(rule.id, enabled)}
                />
              ))}
            </ul>
          </SortableContext>
        )}

      <div className={cn('border-t border-dashed border-components-panel-border bg-workflow-block-parma-bg')}>
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          {/* 与规则行的拖柄 / 序号两格等宽的占位：兜底没有顺序，但读法必须与上面几行对齐。 */}
          <span className="size-6 shrink-0" aria-hidden />
          <span className="w-5 shrink-0" aria-hidden />

          <button
            type="button"
            aria-expanded={fallbackExpanded}
            aria-label={fallbackExpanded ? t('router.rules.collapseAria') : t('router.rules.fallback.edit')}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-state-base-hover"
            onClick={onToggleFallback}
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 text-text-quaternary transition-transform', fallbackExpanded && 'rotate-90')}
              aria-hidden
            />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate system-xs-medium text-text-secondary">{t('router.rules.fallback.name')}</span>
              <span className="truncate system-2xs-regular text-text-tertiary">{t('router.rules.fallback.hint')}</span>
            </span>
          </button>

          <span
            className={cn(
              'max-w-56 shrink-0 truncate system-2xs-regular',
              ruleSet.fallbackModelIds.length === 0 ? 'text-text-warning' : 'text-text-secondary',
            )}
          >
            {fallbackLanding}
          </span>
        </div>

        {fallbackExpanded && (
          // 展开面板里不再重复一行「兜底」标题：上一行就是它，隔 8px 说第二遍等于没说。
          <div className="border-t border-module-border bg-workflow-block-bg px-3 py-3">
            <LogicalModelPicker
              emptyHint={t('router.panel.noLogicalModels')}
              logicalModels={logicalModels}
              selectedIds={ruleSet.fallbackModelIds}
              onToggle={onToggleFallbackModel}
            />
          </div>
        )}
      </div>
    </Card>
  )
}
