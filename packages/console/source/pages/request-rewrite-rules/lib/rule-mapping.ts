import type { RequestRewriteRule as ApiRequestRewriteRule, Protocol } from '@common/schemas'
import { toApiRuleAction, toUiRuleAction, type RequestRewriteRule } from '../types'

/** 服务端规则 → 界面规则。`boundProviders` 不在这个响应里，先置 0，由列表行自己补。 */
export function toUiRule(rule: ApiRequestRewriteRule): RequestRewriteRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    global: rule.scope === 'global',
    source: rule.source,
    protocols: rule.match.clientProtocols,
    match: { clientProtocols: rule.match.clientProtocols, upstreamProtocols: rule.match.upstreamProtocols },
    actions: rule.actions.map((action, index) => toUiRuleAction(action, `${rule.id}-action-${index}`)),
    testCases: rule.testCases.map(testCase => ({ ...testCase })),
    boundProviders: 0,
    updatedTime: rule.updatedTime,
  }
}

/** 界面规则 → 可提交的服务端规则（去掉 id / 时间戳由服务端生成的字段）。 */
export function toApiRule(rule: RequestRewriteRule): Omit<ApiRequestRewriteRule, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'> {
  return {
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    scope: rule.global ? 'global' : 'model',
    schemaVersion: 1,
    // 原样回传：它是用户数据的一部分（编辑一条从模板建的规则不能把它改成「自己写的」），
    // 也是 `rewrite_rule_created.kind` 唯一的来源。
    source: rule.source,
    match: { clientProtocols: rule.protocols, upstreamProtocols: rule.match.upstreamProtocols as Protocol[] },
    actions: rule.actions.map(toApiRuleAction),
    testCases: rule.testCases,
  }
}
