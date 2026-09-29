import { describe, expect, it } from 'vitest'

import { createAppTranslator } from '@common/i18n/catalogs'
import { ROUTER_RULE_PRESETS } from '@common/router/rule-presets'
import type { RouteRule } from '@common/router/route-rules'
import { builtinRouteRuleName } from './builtin-rule-name'

const models = [
  { id: 'default', name: 'Default', enabled: true },
  { id: 'fast', name: 'Fast', enabled: true },
]

const builtinRules = ROUTER_RULE_PRESETS.flatMap(preset => preset.createRuleSet(models).rules)

describe('内置规则名称本地化', () => {
  it('英文界面会翻译所有内置规则名', () => {
    const t = createAppTranslator('en')

    for (const rule of builtinRules) {
      expect(builtinRouteRuleName(rule, t), rule.id).not.toBe(rule.name)
    }
  })

  it('中文界面沿用稳定的内置原文', () => {
    const t = createAppTranslator('zh-CN')

    for (const rule of builtinRules) {
      expect(builtinRouteRuleName(rule, t), rule.id).toBe(rule.name)
    }
  })

  it('用户改过名称后保持原样，不再套用内置翻译', () => {
    const t = createAppTranslator('en')
    const renamed: RouteRule = { ...builtinRules[0], name: 'My custom rule' }

    expect(builtinRouteRuleName(renamed, t)).toBe('My custom rule')
  })

  it('自定义规则与其他规则的未知 id 原样返回', () => {
    const t = createAppTranslator('en')
    const custom: RouteRule = { ...builtinRules[0], id: 'rule-custom', name: 'Custom rule' }

    expect(builtinRouteRuleName(custom, t)).toBe('Custom rule')
  })
})
