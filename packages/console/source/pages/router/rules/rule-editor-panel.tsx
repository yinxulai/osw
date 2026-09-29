import { Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslation } from '@/i18n/provider'
import { createRouteRuleCondition, type RouteRule } from '@common/router/route-rules'
import type { ConditionLogicalOperator } from '@common/router/types'
import type { LogicalModel } from '@common/schemas'
import { PANEL_POPUP_ITEM_CLASSNAME, PANEL_POPUP_SURFACE_CLASSNAME } from '../panel/panel-fields'
import { builtinRouteRuleName } from './builtin-rule-name'
import { ConditionRow } from './condition-row'
import { LandingEditor, RuleFieldLabel } from './landing-editor'

/** 与 `RouteRuleSchema` 的上限一致：前端先拦住，省掉一次「填完才被服务端拒」的往返。 */
const NAME_MAX_LENGTH = 60

interface RuleEditorPanelProps {
  rule: RouteRule
  logicalModels: LogicalModel[]
  /** 刚建出来的那条规则：名字还空着，光标理应在那一格 */
  autoFocusName: boolean
  onChange: (patch: Partial<RouteRule>) => void
}

/**
 * 一条规则的编辑器 —— **就地展开**在它自己那一行下面，不是弹窗。
 *
 * 规则模式的核心是顺序：弹窗会把列表盖住，于是「我在改第几条、它下面还有几条」这两个问题的答案都消失了。
 * 就地展开后，条件与落点在行下面铺开，改一个值立刻能在上面那一行看到新的读法，
 * 顺序也一直在视野里。这不是「图模式的弹窗换个位置」，而是规则表这个形态本来就该有的编辑方式。
 *
 * 改动直接写回规则表（而**不是**一份草稿）：规则表里只有一份内容，
 * 否则「列表上显示的」与「正在改的」会同时存在两种解释，而这一版的语义就是列表本身。
 */
export function RuleEditorPanel(props: RuleEditorPanelProps) {
  const { rule, logicalModels, autoFocusName, onChange } = props
  const t = useTranslation()

  const patchCondition = (index: number, next: RouteRule['conditions'][number]) => {
    onChange({ conditions: rule.conditions.map((item, position) => (position === index ? next : item)) })
  }

  return (
    <div className="grid gap-3 border-t border-module-border bg-workflow-block-bg px-3 py-3">
      <div className="flex flex-wrap items-end gap-4">
        {/* 规则名铺满整行：它是这一块里最长的一段文本，旁边那一格只在两条以上条件时才出现。 */}
        <label className="grid min-w-0 flex-1 gap-1">
          <RuleFieldLabel>{t('router.rules.editor.name')}</RuleFieldLabel>
          <Input
            className="h-8"
            autoFocus={autoFocusName}
            value={builtinRouteRuleName(rule, t)}
            maxLength={NAME_MAX_LENGTH}
            placeholder={t('router.rules.editor.namePlaceholder')}
            onChange={event => onChange({ name: event.target.value })}
          />
        </label>

        {/* 组合方式只在真的有两条以上条件时才有意义，一条条件时摆一个恒等于「无所谓」的下拉只是噪音。 */}
        {rule.conditions.length > 1 && (
          <label className="grid shrink-0 gap-1">
            <RuleFieldLabel>{t('router.panel.logicalOperator')}</RuleFieldLabel>
            <Select
              value={rule.logicalOperator}
              onValueChange={value => onChange({ logicalOperator: value as ConditionLogicalOperator })}
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue>
                  {rule.logicalOperator === 'or' ? t('router.panel.logicalOperatorOr') : t('router.panel.logicalOperatorAnd')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="and">{t('router.panel.logicalOperatorAnd')}</SelectItem>
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="or">{t('router.panel.logicalOperatorOr')}</SelectItem>
              </SelectContent>
            </Select>
          </label>
        )}
      </div>

      <div className="grid gap-2">
        <RuleFieldLabel>{t('router.rules.editor.conditions')}</RuleFieldLabel>

        {rule.conditions.map((condition, index) => (
          <ConditionRow
            key={`${rule.id}-${index}`}
            condition={condition}
            index={index}
            removable
            onChange={next => patchCondition(index, next)}
            onRemove={() => onChange({ conditions: rule.conditions.filter((_, position) => position !== index) })}
          />
        ))}

        {/*
          「再加一条」不是这一块的主操作，而是**下一个还空着的位置**：所以它跟条件行同宽同高、
          圆角一致，只用虚线说明自己还没有内容。之前那个 w-fit 的描边按钮浮在整叠行下面，
          尺寸和网格都对不上，看起来像另一个功能而不是这一列的下一个格子。
          加号落在序号那一列上，整列读下来就是 `1 2 3 +` —— 位置本身就在说「加在最后」。

          零条件时不另起一句提示（会变成两段各自漂浮的安静文字），而是把「不写条件意味着什么」
          放进这个空格子里：这一格此刻的读法就是「留空 = 无条件命中」。
          也因此不写 aria-label —— 让无障碍名字就是屏幕上这句话，而不是把后半句悄悄丢给视障用户。
        */}
        <button
          type="button"
          className="flex h-11.5 w-full items-center gap-1.5 rounded-lg border border-dashed border-module-border px-2 text-left text-text-tertiary outline-none transition-colors hover:border-components-input-border-hover hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => onChange({ conditions: [...rule.conditions, createRouteRuleCondition()] })}
        >
          <span className="flex w-4 shrink-0 items-center justify-end">
            <Plus className="size-3.5" aria-hidden />
          </span>
          <span className="system-xs-regular">{t('router.panel.addCondition')}</span>
          {rule.conditions.length === 0 && (
            <span className="min-w-0 truncate system-xs-regular text-text-quaternary">
              · {t('router.rules.editor.conditionsHint')}
            </span>
          )}
        </button>
      </div>

      <LandingEditor
        landing={rule.landing}
        logicalModels={logicalModels}
        onChange={landing => onChange({ landing })}
      />
    </div>
  )
}
