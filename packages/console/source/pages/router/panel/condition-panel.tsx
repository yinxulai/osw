import { useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { createConditionCase, createConditionRule, getOperatorsByType } from '@common/router/presets'
import { WorkflowButton } from '../components/workflow-button'
import type { NodePanelProps } from '../node-data'
import {
  CONDITION_OPERATOR_META,
  FIELD_OPERAND_OPERATORS,
  type ConditionLogicalOperator,
  type ConditionNode,
  type ConditionOperator,
  type ConditionValueSource,
  type SchemaValueType,
} from '@common/router/types'
import {
  NodePanelCard,
  NodePanelField,
  NodePanelGroupHeader,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

export function ConditionPanel(props: NodePanelProps) {
  const { model, nodeModels, conditionFieldHints, update } = props
  const node = model as ConditionNode
  const t = useTranslation()

  const fieldTypeOf = useCallback(
    (fieldPath: string, fallback: SchemaValueType): SchemaValueType =>
      conditionFieldHints.find(item => item.path === fieldPath)?.valueType ?? fallback,
    [conditionFieldHints],
  )

  const sourceNameOf = useMemo(
    () => new Map(nodeModels.map(item => [item.id, item.name])),
    [nodeModels],
  )

  return (
    <div className="grid gap-3">
      {conditionFieldHints.length === 0 && (
        <NodePanelHint>{t('router.panel.fieldHintsEmpty')}</NodePanelHint>
      )}

      {node.cases.map((conditionCase, caseIndex) => (
        <NodePanelCard key={conditionCase.id} className="gap-3 p-3">
          <NodePanelGroupHeader
            title={t('router.panel.ifBranch', { index: caseIndex + 1 })}
            action={(
              <WorkflowButton
                variant="ghost-destructive"
                disabled={node.cases.length <= 1}
                onClick={() => update(current => current.kind === 'condition'
                  ? { ...current, cases: current.cases.filter(item => item.id !== conditionCase.id) }
                  : current)}
              >
                {t('router.panel.deleteBranch')}
              </WorkflowButton>
            )}
          />

          <NodePanelField label={t('router.panel.branchName')}>
            <Input
              value={conditionCase.name}
              onChange={event => update(current => current.kind === 'condition'
                ? {
                  ...current,
                  cases: current.cases.map(item => item.id === conditionCase.id
                    ? { ...item, name: event.target.value }
                    : item),
                }
                : current)}
            />
          </NodePanelField>

          <NodePanelField label={t('router.panel.logicalOperator')}>
            <Select
              value={conditionCase.logicalOperator}
              onValueChange={value => update(current => current.kind === 'condition'
                ? {
                  ...current,
                  cases: current.cases.map(item => item.id === conditionCase.id
                    ? { ...item, logicalOperator: value as ConditionLogicalOperator }
                    : item),
                }
                : current)}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.logicalOperator')} /></SelectTrigger>
              <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="and">{t('router.panel.logicalOperatorAnd')}</SelectItem>
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="or">{t('router.panel.logicalOperatorOr')}</SelectItem>
              </SelectContent>
            </Select>
          </NodePanelField>

          <div className="grid gap-2">
            {conditionCase.conditions.map((rule, ruleIndex) => {
              const available = conditionFieldHints.some(field => field.path === rule.fieldPath)
              /** 比较字段同样要能指回真实上游；指不到就提示，而不是只显示一个空的下拉。 */
              const compareFieldAvailable = !rule.valueFieldPath
                || conditionFieldHints.some(field => field.path === rule.valueFieldPath)
              const fieldType = fieldTypeOf(rule.fieldPath, rule.valueType)
              const operators = getOperatorsByType(fieldType)

              const patchRule = (patch: Record<string, unknown>) => update(current => current.kind === 'condition'
                ? {
                  ...current,
                  cases: current.cases.map(item => item.id === conditionCase.id
                    ? {
                      ...item,
                      conditions: item.conditions.map((condition, index) =>
                        index === ruleIndex ? { ...condition, ...patch } : condition),
                    }
                    : item),
                }
                : current)

              /** 哪些操作符才有「比较值」（isTrue / empty 这类是一元判定）。 */
              const needsExpectedValue = rule.operator !== 'exists'
                && rule.operator !== 'isTrue'
                && rule.operator !== 'isFalse'
                && rule.operator !== 'empty'
                && rule.operator !== 'notEmpty'

              /** 比较值可以来自另一个字段，例如 `request.body.model in logicalModels[*].id`。 */
              const supportsFieldOperand = FIELD_OPERAND_OPERATORS.includes(rule.operator)
              const usesFieldOperand = supportsFieldOperand && rule.valueSource === 'field'

              return (
                <div key={`${conditionCase.id}-${ruleIndex}`} className="grid gap-2 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2">
                  <NodePanelGroupHeader
                    title={t('router.panel.conditionIndex', { index: ruleIndex + 1 })}
                    action={(
                      <WorkflowButton
                        variant="ghost-destructive"
                        disabled={conditionCase.conditions.length <= 1}
                        onClick={() => update(current => current.kind === 'condition'
                          ? {
                            ...current,
                            cases: current.cases.map(item => item.id === conditionCase.id
                              ? {
                                ...item,
                                conditions: item.conditions.filter((_, index) => index !== ruleIndex),
                              }
                              : item),
                          }
                          : current)}
                      >
                        {t('router.panel.delete')}
                      </WorkflowButton>
                    )}
                  />

                  <NodePanelField label={t('router.panel.fieldPath')}>
                    <Select
                      value={rule.fieldPath}
                      onValueChange={value => update(current => {
                        if (current.kind !== 'condition') return current
                        const field = conditionFieldHints.find(item => item.path === value)
                        const nextType = field?.valueType ?? rule.valueType
                        return {
                          ...current,
                          cases: current.cases.map(item => item.id === conditionCase.id
                            ? {
                              ...item,
                              conditions: item.conditions.map((condition, index) => index === ruleIndex
                                ? {
                                  ...condition,
                                  fieldPath: value,
                                  valueType: nextType,
                                  enumOptions: field?.enumOptions,
                                  operator: getOperatorsByType(nextType)[0] ?? 'equals',
                                }
                                : condition),
                            }
                            : item),
                        }
                      })}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.fieldPath')} /></SelectTrigger>
                      <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                        {conditionFieldHints.map(field => (
                          <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                            {/* 名称前置：先看「来自哪个节点」，再看具体字段路径与类型。 */}
                            {sourceNameOf.get(field.sourceNodeId) ?? field.sourceNodeId} · {field.path} · {field.valueType}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </NodePanelField>

                  {!available && (
                    <NodePanelHint tone="warning">
                      {t('router.panel.fieldMissing', { path: rule.fieldPath })}
                    </NodePanelHint>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <NodePanelField label={t('router.panel.fieldType')}>
                      <Input value={fieldType} disabled />
                    </NodePanelField>

                    <NodePanelField label={t('router.panel.operator')}>
                      <Select
                        value={rule.operator}
                        onValueChange={value => patchRule(FIELD_OPERAND_OPERATORS.includes(value as ConditionOperator)
                          ? { operator: value as ConditionOperator }
                          : { operator: value as ConditionOperator, valueSource: 'literal' })}
                      >
                        {/* 触发器只放目录里的名称，说明留在选项里；传 children 可让 Radix 不再搬运选项内容。 */}
                        <SelectTrigger className="w-full">
                          <SelectValue>{t(CONDITION_OPERATOR_META[rule.operator].labelKey)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper" className={cn(PANEL_POPUP_SURFACE_CLASSNAME, 'w-96')}>
                          {operators.map(operator => (
                            <SelectItem
                              className={cn(PANEL_POPUP_ITEM_CLASSNAME, 'h-auto py-1.5')}
                              key={operator}
                              value={operator}
                            >
                              {/* 两行：名称 + 标识符，下面一行是判定语义说明；说明不换行，保证每项等高。 */}
                              <span className="grid min-w-0 gap-0.5 text-left">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-[13px] leading-4 font-medium text-text-primary">
                                    {t(CONDITION_OPERATOR_META[operator].labelKey)}
                                  </span>
                                  <span className="font-mono system-2xs-regular text-text-quaternary">{operator}</span>
                                </span>
                                <span className="truncate system-2xs-regular text-text-tertiary">
                                  {t(CONDITION_OPERATOR_META[operator].descriptionKey)}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </NodePanelField>
                  </div>

                  {needsExpectedValue && supportsFieldOperand && (
                    <NodePanelField label={t('router.panel.valueSource')}>
                      <Select
                        value={rule.valueSource ?? 'literal'}
                        onValueChange={value => patchRule({ valueSource: value as ConditionValueSource })}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.valueSource')} /></SelectTrigger>
                        <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                          <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="literal">{t('router.panel.valueSourceLiteral')}</SelectItem>
                          <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="field">{t('router.panel.valueSourceField')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </NodePanelField>
                  )}

                  {needsExpectedValue && usesFieldOperand && (
                    <NodePanelField label={t('router.panel.compareField')}>
                      <Select
                        value={rule.valueFieldPath ?? ''}
                        onValueChange={value => patchRule({ valueFieldPath: value })}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.placeholder.fieldPath')} /></SelectTrigger>
                        <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                          {conditionFieldHints.map(field => (
                            <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                              {sourceNameOf.get(field.sourceNodeId) ?? field.sourceNodeId} · {field.path} · {field.valueType}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </NodePanelField>
                  )}

                  {needsExpectedValue && usesFieldOperand && !compareFieldAvailable && (
                    <NodePanelHint tone="warning">
                      {t('router.panel.compareFieldMissing', { path: rule.valueFieldPath ?? '' })}
                    </NodePanelHint>
                  )}

                  {needsExpectedValue && usesFieldOperand && (
                    <NodePanelHint>
                      {rule.operator === 'in' || rule.operator === 'notIn'
                        ? t('router.panel.compareFieldListHint')
                        : t('router.panel.compareFieldValueHint')}
                    </NodePanelHint>
                  )}

                  {needsExpectedValue && !usesFieldOperand && (
                    <NodePanelField label={t('router.panel.compareValue')}>
                      <Input
                        value={rule.value ?? ''}
                        onChange={event => patchRule({ value: event.target.value })}
                      />
                    </NodePanelField>
                  )}

                  {rule.operator === 'between' && (
                    <NodePanelField label={t('router.panel.upperBound')}>
                      <Input
                        value={rule.secondaryValue ?? ''}
                        onChange={event => patchRule({ secondaryValue: event.target.value })}
                      />
                    </NodePanelField>
                  )}
                </div>
              )
            })}
          </div>

          <WorkflowButton
            onClick={() => update(current => current.kind === 'condition'
              ? {
                ...current,
                cases: current.cases.map(item => item.id === conditionCase.id
                  ? { ...item, conditions: [...item.conditions, createConditionRule()] }
                  : item),
              }
              : current)}
          >
            <Plus className="size-3.5" aria-hidden /> {t('router.panel.addCondition')}
          </WorkflowButton>
        </NodePanelCard>
      ))}

      <WorkflowButton
        onClick={() => update(current => current.kind === 'condition'
          ? { ...current, cases: [...current.cases, createConditionCase()] }
          : current)}
      >
        <Plus className="size-3.5" aria-hidden /> {t('router.panel.addBranch')}
      </WorkflowButton>

      <NodePanelHint>
        {t('router.panel.conditionFooter')}
      </NodePanelHint>
    </div>
  )
}
