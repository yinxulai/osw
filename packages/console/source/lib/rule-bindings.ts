import type { ProviderModelRequestRewriteRule, RequestRewriteRule } from '@common/schemas'

/**
 * 「某个供应商模型绑了哪些改写规则」的领域逻辑。
 *
 * 原来这些判断长在 `provider-rule-bindings.tsx` 的 `useEffect` 里：并行取两个接口、
 * 判两个 `success`、把全局规则排在前面、把已绑的从候选里剔掉、按 `binding.enabled &&
 * rule.enabled` 折算开关。它们全部是业务规则，不是排版偏好：
 *
 *  - 全局规则由匹配条件命中，不受这个模型的优先级影响，所以它**永远排第一且只读**；
 *  - 已绑的规则不进候选，重复绑定只会在同一行上多一条策略；
 *  - 两个开关是「与」的关系，只读一个会把「看着开着、其实不生效」画成正常的。
 *
 * 写在这里而不是组件里，一是这些理由有地方写下来，二是可以脱离渲染环境单测。
 */

/** 绑定表里的一行。`stages` 从规则的动作里折出来，用于标「这条规则管哪一段」。 */
export interface BoundRule {
  id: string
  name: string
  stages: Array<'request' | 'response'>
  /** 绑定自身的开关**且**规则本体的开关：任一方关掉，这条绑定都不生效。 */
  enabled: boolean
  /** 全局规则由匹配条件命中，不是这个模型的绑定；它只读，不可移除。 */
  global: boolean
}

/**
 * 一条规则负责哪几个阶段。
 *
 * 去重后按 `request` 在前的固定顺序：同一份数据两次打开不该换一个写法。
 */
export function ruleStagesOf(rule: RequestRewriteRule): Array<'request' | 'response'> {
  const stages = new Set(rule.actions.map(action => action.stage))
  return (['request', 'response'] as const).filter(stage => stages.has(stage))
}

/** `buildBoundRules` 的入参：全部规则与这个模型的全部绑定。 */
export interface BuildBoundRulesInput {
  allRules: readonly RequestRewriteRule[]
  bindings: readonly ProviderModelRequestRewriteRule[]
}

/**
 * 拼出绑定表：全局规则在前、已绑的按服务端给的优先级在后。
 *
 * 已绑但规则本体找不到的绑定直接丢掉——它已经解释不了自己，画出来只是让人点一个不会
 * 生效的开关。已绑但作用域变成全局的也丢掉：它归上面那排管。
 */
export function buildBoundRules(input: BuildBoundRulesInput): BoundRule[] {
  const global = input.allRules.filter(rule => rule.scope === 'global').map(rule => ({
    id: rule.id,
    name: rule.name,
    stages: ruleStagesOf(rule),
    enabled: rule.enabled,
    global: true,
  }))
  const bound = input.bindings.flatMap(binding => {
    const rule = input.allRules.find(item => item.id === binding.ruleId)
    if (!rule || rule.scope === 'global') return []
    return [{
      id: rule.id,
      name: rule.name,
      stages: ruleStagesOf(rule),
      enabled: binding.enabled && rule.enabled,
      global: false,
    }]
  })
  return [...global, ...bound]
}

/** `pickAvailableRules` 的入参：与 `BuildBoundRulesInput` 同一份数据，用法不同。 */
export interface PickAvailableRulesInput {
  allRules: readonly RequestRewriteRule[]
  bindings: readonly ProviderModelRequestRewriteRule[]
}

/**
 * 还没被这个模型绑上的规则，且不含全局规则。
 *
 * 全局规则不在这里出现：它们本来就一直生效，出现在「可添加」里会让人以为自己能把它
 * 关掉。
 */
export function pickAvailableRules(input: PickAvailableRulesInput): RequestRewriteRule[] {
  const boundIds = new Set(input.bindings.map(binding => binding.ruleId))
  return input.allRules.filter(rule => rule.scope !== 'global' && !boundIds.has(rule.id))
}

/** 名字或说明里含关键词。空关键词表示不过滤。 */
export function filterRulesByKeyword<T extends { name: string; description: string }>(rules: readonly T[], keyword: string): T[] {
  const query = keyword.trim().toLocaleLowerCase()
  if (!query) return [...rules]
  return rules.filter(rule => `${rule.name} ${rule.description}`.toLocaleLowerCase().includes(query))
}

/**
 * 追加选中的规则。
 *
 * 不排序：用户刚选的规则应该出现在他刚才看的位置，被重排到别处会让人以为没加上。
 */
export function appendBoundRules(rules: readonly BoundRule[], selected: readonly BoundRule[]): BoundRule[] {
  return [...rules, ...selected.map(rule => ({ ...rule, enabled: true, global: false }))]
}

/** 翻转某一条的开关。全局规则不可动，由调用方保证只传非全局的。 */
export function toggleBoundRule(rules: readonly BoundRule[], id: string, enabled: boolean): BoundRule[] {
  return rules.map(rule => (rule.id === id ? { ...rule, enabled } : rule))
}

/** 移除某一条绑定。 */
export function removeBoundRule(rules: readonly BoundRule[], id: string): BoundRule[] {
  return rules.filter(rule => rule.id !== id)
}

/**
 * 绑定 → 提交给服务端的输入。
 *
 * 顺序即优先级，所以按下标连续编号；全局规则剔掉（它们不是这个模型的绑定）。
 */
export function toBindingInput(rules: readonly BoundRule[]) {
  return rules
    .filter(rule => !rule.global)
    .map((rule, priority) => ({ ruleId: rule.id, priority, enabled: rule.enabled }))
}

/**
 * 列表行只需要名字。
 *
 * 找不到对应规则的绑定（规则已被删）不产出占位：宁可少一个徽标，也不要一个点不动的
 * 空标签。
 */
export function boundRuleNames(allRules: readonly RequestRewriteRule[], bindings: readonly ProviderModelRequestRewriteRule[]): string[] {
  return bindings.flatMap(binding => {
    const name = allRules.find(rule => rule.id === binding.ruleId)?.name
    return name ? [name] : []
  })
}
