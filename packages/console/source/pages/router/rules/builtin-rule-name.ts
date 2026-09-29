import type { UiCatalogKey } from '@common/i18n/catalogs'
import {
  BUILTIN_ROUTE_RULE_NAMES,
  type BuiltinRouteRuleId,
  type RouteRule,
} from '@common/router/route-rules'
import type { Translate } from './rule-summary'

const BUILTIN_ROUTE_RULE_NAME_KEYS = {
  'rule-model-direct': 'router.rules.builtin.model-direct.name',
  'rule-client-cursor': 'router.rules.builtin.client-cursor.name',
  'rule-client-claude-cli': 'router.rules.builtin.client-claude-cli.name',
  'rule-model-claude': 'router.rules.builtin.model-claude.name',
  'rule-model-openai': 'router.rules.builtin.model-openai.name',
  'rule-protocol-anthropic': 'router.rules.builtin.protocol-anthropic.name',
  'rule-protocol-responses': 'router.rules.builtin.protocol-responses.name',
} as const satisfies Record<BuiltinRouteRuleId, UiCatalogKey>

/**
 * 读取规则用于展示的名称。
 *
 * 只有「固定内置 id + 落库原文仍未改动」时才翻译。用户改过名称后，`name` 已不再等于原文，
 * 这里会原样显示，避免把用户数据误认成内置文案。
 */
export function builtinRouteRuleName(rule: Pick<RouteRule, 'id' | 'name'>, t: Translate): string {
  const key = BUILTIN_ROUTE_RULE_NAME_KEYS[rule.id as BuiltinRouteRuleId]
  if (!key) return rule.name

  const sourceName = BUILTIN_ROUTE_RULE_NAMES[rule.id as BuiltinRouteRuleId]
  return rule.name === sourceName ? t(key) : rule.name
}
