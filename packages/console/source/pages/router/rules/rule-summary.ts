/**
 * 规则表的「读法」：把一条规则读成一句人话。
 *
 * 规则模式的全部卖点就是「一眼读完整张表」，所以列表、试运行结果、删除确认说的是同一句话 ——
 * 三处各写一份摘要逻辑，迟早会出现「列表说命中、结果说没命中」这种没法解释的分歧。
 */

import type { Translator } from '@common/i18n'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import {
  parseRouteRuleFieldPath,
  routeRuleFieldKindMeta,
  type RouteRule,
  type RouteRuleCondition,
} from '@common/router/route-rules'
import { CONDITION_OPERATOR_META, FIELD_OPERAND_OPERATORS } from '@common/router/types'

export type Translate = Translator<UiCatalogKey>

/** 条件左值读成一句：`请求头 user-agent`；来源本身已说清含义时（如「请求模型」）就没有后半段。 */
export function describeConditionField(condition: RouteRuleCondition, t: Translate): string {
  const spec = parseRouteRuleFieldPath(condition.fieldPath)
  const source = t(routeRuleFieldKindMeta(spec.kind).labelKey)
  return spec.name ? `${source} ${spec.name}` : source
}

/**
 * 条件右值。
 *
 * 一元判定（存在 / 为空 / 为真 …）没有右值，返回空串让调用方省掉那个空格；
 * 比较值来自另一个字段时显示字段路径本身 —— 规则模式里这一定是个手写路径，显示取值反而不可读。
 */
export function describeConditionOperand(condition: RouteRuleCondition, t: Translate): string {
  if (FIELD_OPERAND_OPERATORS.includes(condition.operator) && condition.valueSource === 'field') {
    return condition.valueFieldPath?.trim() || t('router.rules.operandAnyField')
  }
  if (condition.operator === 'between') {
    return `${(condition.value ?? '').trim()} ~ ${(condition.secondaryValue ?? '').trim()}`
  }
  return (condition.value ?? '').trim()
}

/** 一条条件读成一句人话：`请求头 user-agent 包含 Cursor`。 */
export function describeCondition(condition: RouteRuleCondition, t: Translate): string {
  const field = describeConditionField(condition, t)
  const operator = t(CONDITION_OPERATOR_META[condition.operator].labelKey)
  const operand = describeConditionOperand(condition, t)
  return operand ? `${field} ${operator} ${operand}` : `${field} ${operator}`
}

/**
 * 一条规则的条件整体读成一串。
 *
 * 多条之间用「且 / 或」原样连接，而不是用逗号收成一堆 ——
 * 组合方式本身就是判定语义的一部分，把它换成中性分隔符等于把「为什么命中」藏起来。
 */
export function describeConditions(rule: RouteRule, t: Translate): string {
  if (rule.conditions.length === 0) return t('router.rules.noConditions')
  const joiner = rule.logicalOperator === 'or' ? t('router.rules.joinOr') : t('router.rules.joinAnd')
  return rule.conditions.map(condition => describeCondition(condition, t)).join(` ${joiner} `)
}

/** 落点读成一句：指定模型列 id，取字段列路径。 */
export function describeLanding(landing: RouteRule['landing'], t: Translate): string {
  if (landing.source === 'variable') return landing.variablePath.trim() || t('router.rules.variablePathEmpty')
  if (landing.logicalModelIds.length === 0) return t('router.rules.landingEmpty')
  return landing.logicalModelIds.join(', ')
}
