import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { createRouteRuleCondition, type RouteRule, type RouteRuleCondition, type RouteRuleLanding } from '@common/router/route-rules'
import {
  describeCondition,
  describeConditionField,
  describeConditionOperand,
  describeConditions,
  describeLanding,
} from './rule-summary'

const t = createAppTranslator('zh-CN')

function condition(overrides: Partial<RouteRuleCondition>): RouteRuleCondition {
  return { ...createRouteRuleCondition(), ...overrides }
}

function rule(overrides: Partial<RouteRule>): RouteRule {
  return {
    id: 'rule-1',
    name: '测试规则',
    enabled: true,
    logicalOperator: 'and',
    conditions: [],
    landing: { source: 'fixed', logicalModelIds: [], variablePath: '' },
    ...overrides,
  }
}

function landing(overrides: Partial<RouteRuleLanding>): RouteRuleLanding {
  return { source: 'fixed', logicalModelIds: [], variablePath: '', ...overrides }
}

describe('describeConditionField', () => {
  // 来源已说清含义时（请求模型名）不该再拖一截名字：`请求模型名` 就够了。
  it('来源本身够清楚时不补名称', () => {
    expect(describeConditionField(condition({ fieldPath: 'request.body.model' }), t)).toBe('请求模型名')
  })

  // 请求头只有「请求头」两个字是完全读不出条件的，头名必须带上。
  it('来源需要名称（请求头）时拼在后面', () => {
    expect(describeConditionField(condition({ fieldPath: 'request.headers.user-agent' }), t)).toBe('请求头 user-agent')
  })

  // 手写路径也得原样读得出来：它没被解析成任何内置来源，但用户写的是什么就该显示什么。
  it('认不出的路径照原样显示，并标成自定义', () => {
    expect(describeConditionField(condition({ fieldPath: 'request.body.tenant' }), t)).toBe('请求体字段 tenant')
    expect(describeConditionField(condition({ fieldPath: 'unknown.thing' }), t)).toBe('自定义路径 unknown.thing')
  })
})

describe('describeConditionOperand', () => {
  it('比较固定值时直接给出那个值', () => {
    expect(describeConditionOperand(condition({ value: '  Cursor  ' }), t)).toBe('Cursor')
  })

  // 一元判定没有右值：返回空串，调用方才能省掉那个空格。
  it('存在 / 为空这类判定没有右值', () => {
    expect(describeConditionOperand(condition({ operator: 'exists', value: '' }), t)).toBe('')
  })

  it('区间读成 `下界 ~ 上界`', () => {
    expect(describeConditionOperand(condition({ operator: 'between', value: '1', secondaryValue: '5' }), t))
      .toBe('1 ~ 5')
  })

  // 右值来自另一个字段时显示**路径**而不是取值：规则模式里这一定是手写路径，
  // 显示「当时的取值」第二天就对不上。
  it('右值来自另一个字段时显示字段路径', () => {
    const c = condition({ operator: 'in', valueSource: 'field', valueFieldPath: ' logicalModels[*].modelId ' })
    expect(describeConditionOperand(c, t)).toBe('logicalModels[*].modelId')
  })

  it('选了「来自字段」却没填路径时给出提示文案', () => {
    const c = condition({ operator: 'in', valueSource: 'field', valueFieldPath: '   ' })
    expect(describeConditionOperand(c, t)).toBe('另一个字段')
  })
})

describe('describeCondition', () => {
  it('左值 + 操作符 + 右值拼成一句', () => {
    const c = condition({ fieldPath: 'request.headers.user-agent', operator: 'contains', value: 'Cursor' })
    expect(describeCondition(c, t)).toBe('请求头 user-agent 包含 Cursor')
  })

  // 一元判定末尾不能挂一个多余空格，否则列表里每行右边都多出一点。
  it('没有右值时不留尾随空格', () => {
    const c = condition({ fieldPath: 'request.headers.user-agent', operator: 'exists', value: '' })
    expect(describeCondition(c, t)).toBe('请求头 user-agent 存在')
  })
})

describe('describeConditions', () => {
  // 空条件不是「没写」而是「无条件命中」，它是「前面都不匹配就落这里」的合法写法，
  // 读成空白会让人以为这条规则坏了。
  it('空条件读成无条件命中', () => {
    expect(describeConditions(rule({ conditions: [] }), t)).toBe('无条件（命中）')
  })

  it('多条条件用「且」原样连接', () => {
    const conditions = [
      condition({ fieldPath: 'request.headers.user-agent', operator: 'contains', value: 'Cursor' }),
      condition({ fieldPath: 'request.body.model', operator: 'in', value: 'claude-sonnet-4' }),
    ]
    expect(describeConditions(rule({ logicalOperator: 'and', conditions }), t))
        // 连接符两侧的空格是 `describeConditions` 里 `` ` ${joiner} ` `` 的一部分，不是排版失误。
        .toBe('请求头 user-agent 包含 Cursor 且 请求模型名 属于 claude-sonnet-4')
  })

  // 组合方式本身就是判定语义的一部分，不能收成一个中性分隔符。
  it('逻辑运算符为 or 时换成「或」', () => {
    const conditions = [
      condition({ fieldPath: 'request.method', operator: 'equals', value: 'POST' }),
      condition({ fieldPath: 'request.method', operator: 'equals', value: 'PUT' }),
    ]
    expect(describeConditions(rule({ logicalOperator: 'or', conditions }), t))
        .toBe('请求方法 等于 POST 或 请求方法 等于 PUT')
  })
})

describe('describeLanding', () => {
  it('指定模型时列出 id，一条不落', () => {
    expect(describeLanding(landing({ source: 'fixed', logicalModelIds: ['a', 'b'] }), t)).toBe('a, b')
  })

  // 落点是模型 id，「名字」在这里是稳定契约，不该被本地化。
  it('指定模型为空时说明还没选', () => {
    expect(describeLanding(landing({ source: 'fixed', logicalModelIds: [] }), t)).toBe('尚未选择逻辑模型')
  })

  it('取字段时显示字段路径', () => {
    expect(describeLanding(landing({ source: 'variable', variablePath: ' request.body.model ' }), t))
      .toBe('request.body.model')
  })

  it('取字段但路径为空时给出填写提示', () => {
    expect(describeLanding(landing({ source: 'variable', variablePath: '   ' }), t)).toBe('填写字段路径')
  })
})
