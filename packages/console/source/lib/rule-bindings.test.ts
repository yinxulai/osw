import { describe, expect, it } from 'vitest'
import type { ProviderModelRequestRewriteRule, RequestRewriteRule } from '@common/schemas'
import {
  appendBoundRules,
  boundRuleNames,
  buildBoundRules,
  filterRulesByKeyword,
  pickAvailableRules,
  removeBoundRule,
  ruleStagesOf,
  toBindingInput,
  toggleBoundRule,
} from './rule-bindings'

/*
 * 供应商模型与请求重写规则的绑定关系。
 *
 * 这里判的是四件会直接影响「请求体到底会不会被改」的事：
 *
 *  1. 全局规则必须排第一且只读——它们由匹配条件命中，不受模型的优先级影响。
 *  2. 两个开关是「与」的关系（`binding.enabled && rule.enabled`）。
 *  3. 已绑的不进候选；找不到本体的绑定不画。
 *  4. 顺序即优先级，提交时按下标重新编号。
 *
 * 之所以单独测一个纯函数模块：这些都是业务规则，不该只能靠在 jsdom 里点开关来验证。
 */

function rule(overrides: Partial<RequestRewriteRule> = {}): RequestRewriteRule {
  return {
    id: 'rule_a',
    name: 'Alpha',
    description: '描述',
    enabled: true,
    scope: 'model',
    schemaVersion: 1,
    source: 'user',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ type: 'header-set', stage: 'request', name: 'x-a', value: '1' }],
    testCases: [],
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

function binding(overrides: Partial<ProviderModelRequestRewriteRule> = {}): ProviderModelRequestRewriteRule {
  return {
    providerModelId: 'pm_a',
    ruleId: 'rule_a',
    priority: 0,
    enabled: true,
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

describe('ruleStagesOf', () => {
  it('从动作里折出阶段，且 request 永远排在 response 前', () => {
    expect(ruleStagesOf(rule({
      actions: [
        { type: 'header-set', stage: 'response', name: 'x-b', value: '2' },
        { type: 'header-set', stage: 'request', name: 'x-a', value: '1' },
      ],
    }))).toEqual(['request', 'response'])
  })

  it('同一阶段多个动作只算一次', () => {
    expect(ruleStagesOf(rule({
      actions: [
        { type: 'header-set', stage: 'request', name: 'x-a', value: '1' },
        { type: 'header-set', stage: 'request', name: 'x-b', value: '2' },
      ],
    }))).toEqual(['request'])
  })

  it('没有动作时是空数组——它不负责任何阶段，界面上不该标任何徽标', () => {
    expect(ruleStagesOf(rule({ actions: [] }))).toEqual([])
  })
})

describe('buildBoundRules', () => {
  it('全局规则排在普通规则前面，且标记为 global', () => {
    const result = buildBoundRules({
      allRules: [rule({ id: 'rule_normal', name: '普通' }), rule({ id: 'rule_global', name: '全局', scope: 'global' })],
      bindings: [binding({ ruleId: 'rule_normal' })],
    })
    expect(result.map(item => [item.name, item.global])).toEqual([['全局', true], ['普通', false]])
  })

  it('规则本体被停用时，绑定画成停用——绑着不生效', () => {
    const [item] = buildBoundRules({ allRules: [rule({ enabled: false })], bindings: [binding({ enabled: true })] })
    expect(item.enabled).toBe(false)
  })

  it('绑定自己被停用时也是停用', () => {
    const [item] = buildBoundRules({ allRules: [rule({ enabled: true })], bindings: [binding({ enabled: false })] })
    expect(item.enabled).toBe(false)
  })

  it('绑定指向一条已经不存在的规则时跳过，不画空行', () => {
    expect(buildBoundRules({ allRules: [], bindings: [binding({ ruleId: 'rule_gone' })] })).toEqual([])
  })

  it('绑定指向一条已经变成全局的规则时也跳过——它归上面那排管', () => {
    const result = buildBoundRules({
      allRules: [rule({ id: 'rule_global', name: '全局', scope: 'global' })],
      bindings: [binding({ ruleId: 'rule_global' })],
    })
    expect(result).toHaveLength(1)
    expect(result[0].global).toBe(true)
  })

  it('已绑的按服务端给的优先级顺序出现', () => {
    const result = buildBoundRules({
      allRules: [rule({ id: 'rule_a', name: 'A' }), rule({ id: 'rule_b', name: 'B' })],
      bindings: [binding({ ruleId: 'rule_b', priority: 0 }), binding({ ruleId: 'rule_a', priority: 1 })],
    })
    expect(result.map(item => item.name)).toEqual(['B', 'A'])
  })
})

describe('pickAvailableRules', () => {
  it('已绑的不进候选，全局规则也不进（它们本来就一直生效）', () => {
    const result = pickAvailableRules({
      allRules: [rule({ id: 'rule_a' }), rule({ id: 'rule_b' }), rule({ id: 'rule_g', scope: 'global' })],
      bindings: [binding({ ruleId: 'rule_a' })],
    })
    expect(result.map(item => item.id)).toEqual(['rule_b'])
  })

  it('绑定指向一条已删除的规则时，那条规则（若还在列表里）也不会凭 ids 漏进候选', () => {
    // 服务端的 list 已经不含软删除项，这里模拟的正是「绑定留了个孤儿 id」。
    const result = pickAvailableRules({ allRules: [rule({ id: 'rule_a' })], bindings: [binding({ ruleId: 'rule_gone' })] })
    expect(result.map(item => item.id)).toEqual(['rule_a'])
  })
})

describe('filterRulesByKeyword', () => {
  const rules = [
    { name: 'Alpha', description: '给上游加鉴权头' },
    { name: 'Beta', description: '删除 temperature' },
  ]

  it('空关键词不过滤', () => {
    expect(filterRulesByKeyword(rules, '   ')).toEqual(rules)
  })

  it('名字与说明都参与匹配', () => {
    expect(filterRulesByKeyword(rules, 'temperature')).toEqual([rules[1]])
    expect(filterRulesByKeyword(rules, 'alph')).toEqual([rules[0]])
  })

  it('大小写不敏感', () => {
    expect(filterRulesByKeyword(rules, 'ALPHA')).toEqual([rules[0]])
  })
})

describe('appendBoundRules / toggleBoundRule / removeBoundRule', () => {
  const existing = [{ id: 'rule_global', name: '全局', stages: ['request'] as Array<'request' | 'response'>, enabled: true, global: true }]

  it('追加到末尾，且强制为可写、启用', () => {
    const next = appendBoundRules(existing, [{ id: 'rule_a', name: 'A', stages: ['request'], enabled: false, global: false }])
    expect(next.map(item => item.id)).toEqual(['rule_global', 'rule_a'])
    // 新加上来的绑定默认是开的：用户选了它，就是想让它生效。
    expect(next[1].enabled).toBe(true)
    expect(next[1].global).toBe(false)
  })

  it('翻转只影响那一条', () => {
    const rules = appendBoundRules(existing, [{ id: 'rule_a', name: 'A', stages: ['request'], enabled: true, global: false }])
    const next = toggleBoundRule(rules, 'rule_a', false)
    expect(next[0].enabled).toBe(true)
    expect(next[1].enabled).toBe(false)
  })

  it('移除只影响那一条', () => {
    const rules = appendBoundRules(existing, [{ id: 'rule_a', name: 'A', stages: ['request'], enabled: true, global: false }])
    expect(removeBoundRule(rules, 'rule_a').map(item => item.id)).toEqual(['rule_global'])
  })
})

describe('toBindingInput', () => {
  it('剔掉全局规则，并按当前顺序连续编号', () => {
    const input = toBindingInput([
      { id: 'rule_global', name: '全局', stages: ['request'], enabled: true, global: true },
      { id: 'rule_b', name: 'B', stages: ['request'], enabled: true, global: false },
      { id: 'rule_a', name: 'A', stages: ['response'], enabled: false, global: false },
    ])
    expect(input).toEqual([
      { ruleId: 'rule_b', priority: 0, enabled: true },
      { ruleId: 'rule_a', priority: 1, enabled: false },
    ])
  })

  it('只剩全局规则时提交空数组（把绑定清空是合法状态）', () => {
    expect(toBindingInput([{ id: 'rule_global', name: '全局', stages: [], enabled: true, global: true }])).toEqual([])
  })
})

describe('boundRuleNames', () => {
  it('按绑定的顺序给出名字', () => {
    expect(boundRuleNames(
      [rule({ id: 'rule_a', name: 'A' }), rule({ id: 'rule_b', name: 'B' })],
      [binding({ ruleId: 'rule_b' }), binding({ ruleId: 'rule_a' })],
    )).toEqual(['B', 'A'])
  })

  it('找不到本体的绑定不产出占位——宁可少一个徽标，也不要一个点不动的空标签', () => {
    expect(boundRuleNames([], [binding({ ruleId: 'rule_gone' })])).toEqual([])
  })
})
