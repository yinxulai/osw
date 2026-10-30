import type { RequestRewriteRule, RuleStatusFilter } from '../types'

/**
 * 草稿相对已保存版本是否有改动。
 *
 * `updatedTime === null` 代表这是一条还没保存过的新规则（含模板草稿），一律视为「脏」；
 * 否则与列表里那份已保存的逐字段序列化比较。
 */
export function isRuleDirty(savedRule: RequestRewriteRule | undefined, draft: RequestRewriteRule): boolean {
  if (draft.updatedTime === null) return true
  return savedRule ? JSON.stringify(savedRule) !== JSON.stringify(draft) : false
}

/** 按关键词与启用状态过滤规则。关键词匹配名称、描述与每条动作的字段。 */
export function filterRules(rules: readonly RequestRewriteRule[], search: string, statusFilter: RuleStatusFilter): RequestRewriteRule[] {
  const keyword = search.trim().toLocaleLowerCase()
  return rules.filter(rule => {
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'enabled' ? rule.enabled : !rule.enabled)
    if (!matchesStatus) return false
    if (!keyword) return true
    const searchable = [rule.name, rule.description, ...rule.actions.flatMap(action => [action.target, action.operation, action.path, action.value ?? ''])]
      .join(' ')
      .toLocaleLowerCase()
    return searchable.includes(keyword)
  })
}

/** 复制一条规则时需要的上下文：复制件的名称（已本地化）与一个生成新 id 用的时间戳。 */
export interface DuplicateRuleContext {
  name: string
  now: number
}

/**
 * 复制一条规则：换一套新 id、落到「本地未保存」（`updatedTime: null`、非全局、绑定数清零），
 * 动作与测试用例也各自换新 id。
 */
export function duplicateRule(source: RequestRewriteRule, context: DuplicateRuleContext): RequestRewriteRule {
  const { name, now } = context
  return {
    ...source,
    id: `rule-${now}`,
    name,
    global: false,
    boundProviders: 0,
    updatedTime: null,
    actions: source.actions.map((action, index) => ({ ...action, id: `action-${now}-${index}` })),
    testCases: source.testCases.map((testCase, index) => ({ ...testCase, id: `test-${now}-${index}` })),
  }
}
