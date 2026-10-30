import { createId } from '@common/router/presets'
import type { RouteRule, RouteRuleSet } from '@common/router/route-rules'

/**
 * 规则集的纯变换——零 React，与图模式的 `graph-ops` 对应。
 *
 * `rules-studio` 的那些 `setRuleSet(current => ...)` 内层逻辑都收到这里：改一条、追加、
 * 复制、拖拽重排、切兜底模型、删一条。各函数都返回新规则集，没有实际变化时返回原引用，
 * 可脱离渲染单测。
 */

/** 改写某条规则的若干字段。 */
export function patchRuleInSet(set: RouteRuleSet, ruleId: string, patch: Partial<RouteRule>): RouteRuleSet {
  return { ...set, rules: set.rules.map(rule => (rule.id === ruleId ? { ...rule, ...patch } : rule)) }
}

/** 追加一条规则到**末尾**：放最后不影响现有分流，用户拖到哪格才算开始生效。 */
export function appendRule(set: RouteRuleSet, rule: RouteRule): RouteRuleSet {
  return { ...set, rules: [...set.rules, rule] }
}

/** 复制一条规则，紧跟在原规则后面（排在原处最容易看出「这两条是一对」）。 */
export function duplicateRuleInSet(set: RouteRuleSet, ruleId: string): RouteRuleSet {
  const index = set.rules.findIndex(rule => rule.id === ruleId)
  if (index < 0) return set

  const source = set.rules[index]
  const copy: RouteRule = {
    ...source,
    id: createId('rule'),
    conditions: source.conditions.map(condition => ({ ...condition })),
    landing: { ...source.landing, logicalModelIds: [...source.landing.logicalModelIds] },
  }
  const rules = [...set.rules]
  rules.splice(index + 1, 0, copy)
  return { ...set, rules }
}

/** 拖拽重排：把 `activeId` 移到 `overId` 所在的位置。任一 id 找不到就原样返回。 */
export function reorderRules(set: RouteRuleSet, activeId: string | number, overId: string | number): RouteRuleSet {
  const from = set.rules.findIndex(rule => rule.id === activeId)
  const to = set.rules.findIndex(rule => rule.id === overId)
  if (from < 0 || to < 0) return set
  const rules = [...set.rules]
  const [moved] = rules.splice(from, 1)
  rules.splice(to, 0, moved)
  return { ...set, rules }
}

/** 勾选/取消兜底模型。勾选时追加到末尾并去重，取消时移除。 */
export function toggleFallbackModelInSet(set: RouteRuleSet, modelId: string, checked: boolean): RouteRuleSet {
  return {
    ...set,
    fallbackModelIds: checked
      ? [...set.fallbackModelIds.filter(id => id !== modelId), modelId]
      : set.fallbackModelIds.filter(id => id !== modelId),
  }
}

/** 删除一条规则。 */
export function removeRuleFromSet(set: RouteRuleSet, ruleId: string): RouteRuleSet {
  return { ...set, rules: set.rules.filter(rule => rule.id !== ruleId) }
}
