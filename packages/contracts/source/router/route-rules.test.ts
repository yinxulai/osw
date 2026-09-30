import { describe, expect, it } from 'vitest'
import {
  createDefaultRouteRuleSet,
  createRouteRule,
  createRouteRuleCondition,
  isSameRouteRuleSet,
  MAX_ROUTE_RULES,
  parseRouteRuleFieldPath,
  ROUTE_RULE_DEFAULT_VARIABLE_PATH,
  ROUTE_RULE_FIELD_KINDS,
  ROUTE_RULE_SET_VERSION,
  RouteRuleSetSchema,
  routeRuleFieldKindMeta,
  routeRuleFieldValueType,
  toRouteRuleFieldPath,
  UNSAVED_ROUTE_RULE_VERSION,
} from './route-rules'
import type { RouteRuleFieldKind } from './route-rules'
import type { RuntimeLogicalModel } from './types'

/**
 * 规则表验收。
 *
 * 这里锁的是**规则模式自己的**那一半：字段路径的双向映射（编辑器打开一条旧规则不能改写它）、
 * 工厂默认值、内建默认表的结构。判定行为属于引擎，见 `route-rule-engine.test.ts`。
 */

const models: RuntimeLogicalModel[] = [
  { modelId: 'default', enabled: true },
  { modelId: 'model-fast', enabled: true },
]

describe('route rule field kinds', () => {
  it('每个来源都有唯一 kind，且至少有一个不需要补名称的来源', () => {
    const kinds = ROUTE_RULE_FIELD_KINDS.map(meta => meta.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(ROUTE_RULE_FIELD_KINDS.some(meta => !meta.needsName)).toBe(true)
    // 末尾必须是 custom：`routeRuleFieldKindMeta` 的兜底项就是它
    expect(kinds[kinds.length - 1]).toBe('custom')
  })

  it('已知来源取回自己的元信息，未知来源退化成 custom', () => {
    expect(routeRuleFieldKindMeta('header').prefix).toBe('request.headers.')
    expect(routeRuleFieldKindMeta('model').prefix).toBe(ROUTE_RULE_DEFAULT_VARIABLE_PATH)
    expect(routeRuleFieldKindMeta('not-a-kind' as RouteRuleFieldKind).kind).toBe('custom')
  })
})

describe('route rule field path', () => {
  it('需要补名称的来源拼上名称，并去掉首尾空白', () => {
    expect(toRouteRuleFieldPath({ kind: 'header', name: '  x-tenant  ' })).toBe('request.headers.x-tenant')
    expect(toRouteRuleFieldPath({ kind: 'body', name: ' model ' })).toBe('request.body.model')
    expect(toRouteRuleFieldPath({ kind: 'metadata', name: 'user' })).toBe('metadata.user')
  })

  it('不需要名称的来源忽略名称输入', () => {
    expect(toRouteRuleFieldPath({ kind: 'model', name: 'ignored' })).toBe(ROUTE_RULE_DEFAULT_VARIABLE_PATH)
    expect(toRouteRuleFieldPath({ kind: 'method', name: '' })).toBe('request.method')
    expect(toRouteRuleFieldPath({ kind: 'logicalModelIds', name: '' })).toBe('logicalModels[*].modelId')
  })

  it('整条路径就是字段的来源不带名称', () => {
    expect(parseRouteRuleFieldPath('request.method')).toEqual({ kind: 'method', name: '' })
    expect(parseRouteRuleFieldPath(' route.transport ')).toEqual({ kind: 'transport', name: '' })
    expect(parseRouteRuleFieldPath(ROUTE_RULE_DEFAULT_VARIABLE_PATH)).toEqual({ kind: 'model', name: '' })
  })

  it('带前缀的来源把前缀之后的部分当名称', () => {
    expect(parseRouteRuleFieldPath('request.headers.user-agent')).toEqual({ kind: 'header', name: 'user-agent' })
    expect(parseRouteRuleFieldPath('request.body.tools')).toEqual({ kind: 'body', name: 'tools' })
    expect(parseRouteRuleFieldPath('metadata.tenant')).toEqual({ kind: 'metadata', name: 'tenant' })
  })

  it('认不出来的路径原样落到 custom，手写路径不会被改写', () => {
    expect(parseRouteRuleFieldPath('some.custom.path')).toEqual({ kind: 'custom', name: 'some.custom.path' })
    expect(parseRouteRuleFieldPath('')).toEqual({ kind: 'custom', name: '' })
  })

  it('来源 + 名称往返后不变', () => {
    for (const spec of [
      { kind: 'header' as const, name: 'x-provider' },
      { kind: 'model' as const, name: '' },
      { kind: 'path' as const, name: '' },
      // 手写路径不能以任何已知来源的前缀开头，否则会被认回那个来源 —— `custom` 是兜底而非改写
      { kind: 'custom' as const, name: 'route.attempt.index' },
    ]) {
      expect(parseRouteRuleFieldPath(toRouteRuleFieldPath(spec))).toEqual(spec)
    }
  })

  it('值类型按来源给出，认不准的来源是 unknown', () => {
    expect(routeRuleFieldValueType('request.method')).toBe('string')
    expect(routeRuleFieldValueType('logicalModels[*].modelId')).toBe('string')
    expect(routeRuleFieldValueType('request.body.anything')).toBe('unknown')
    expect(routeRuleFieldValueType('not.a.known.path')).toBe('unknown')
  })
})

describe('route rule factories', () => {
  it('新建规则带上一条可直接用的 UA 条件与固定落点', () => {
    const rule = createRouteRule(['model-fast'])

    expect(rule.id).toMatch(/^rule-/)
    expect(rule).toMatchObject({ name: '', enabled: true, logicalOperator: 'and' })
    expect(rule.conditions).toHaveLength(1)
    expect(rule.landing).toEqual({
      source: 'fixed',
      logicalModelIds: ['model-fast'],
      variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH,
    })
  })

  it('新建规则默认没有落点，且不会和传入数组共享引用', () => {
    const landingModelIds = ['model-fast']
    const rule = createRouteRule(landingModelIds)
    rule.landing.logicalModelIds.push('model-smart')

    expect(createRouteRule().landing.logicalModelIds).toEqual([])
    expect(landingModelIds).toEqual(['model-fast'])
  })

  it('默认条件的字段是请求头且带示例值', () => {
    expect(createRouteRuleCondition()).toEqual({
      fieldPath: 'request.headers.user-agent',
      valueType: 'string',
      operator: 'contains',
      valueSource: 'literal',
      valueFieldPath: '',
      value: 'Cursor',
    })
  })
})

describe('default route rule set', () => {
  it('内建默认表只声明一条「请求模型是逻辑模型就直连」的规则', () => {
    const ruleSet = createDefaultRouteRuleSet(models)

    expect(ruleSet.version).toBe(ROUTE_RULE_SET_VERSION)
    expect(ruleSet.rules).toHaveLength(1)
    expect(ruleSet.rules[0]).toMatchObject({
      id: 'rule-model-direct',
      enabled: true,
      logicalOperator: 'and',
      landing: { source: 'variable', variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH },
    })
    expect(ruleSet.rules[0].conditions).toEqual([
      {
        fieldPath: ROUTE_RULE_DEFAULT_VARIABLE_PATH,
        valueType: 'string',
        operator: 'in',
        valueSource: 'field',
        valueFieldPath: 'logicalModels[*].modelId',
      },
    ])
    expect(ruleSet.fallbackModelIds.length).toBeGreaterThan(0)
  })

  it('内建默认表能被 schema 解析（默认值不会把它判成非法）', () => {
    const ruleSet = createDefaultRouteRuleSet(models)
    expect(RouteRuleSetSchema.parse(ruleSet)).toEqual(ruleSet)
  })

  it('相同内容判为同一份，任一处改动即不同', () => {
    const left = createDefaultRouteRuleSet(models)
    const right = createDefaultRouteRuleSet(models)
    const modified = { ...right, fallbackModelIds: [...right.fallbackModelIds, 'extra'] }

    expect(isSameRouteRuleSet(left, right)).toBe(true)
    expect(isSameRouteRuleSet(left, modified)).toBe(false)
  })
})

describe('route rule set schema', () => {
  it('缺省字段有默认值，版本号只能是当前常量', () => {
    const parsed = RouteRuleSetSchema.parse({
      version: ROUTE_RULE_SET_VERSION,
      rules: [
        {
          id: 'r1',
          name: 'r1',
          enabled: true,
          logicalOperator: 'or',
          conditions: [],
          landing: { source: 'fixed' },
        },
      ],
    })

    expect(parsed.fallbackModelIds).toEqual([])
    expect(parsed.rules[0].landing).toEqual({
      source: 'fixed',
      logicalModelIds: [],
      variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH,
    })
    expect(parsed.rules[0].conditions).toEqual([])
    expect(() => RouteRuleSetSchema.parse({ version: ROUTE_RULE_SET_VERSION + 1, rules: [] })).toThrow()
    expect(UNSAVED_ROUTE_RULE_VERSION).toBe(0)
  })

  it('规则条数超过上限时拒绝解析', () => {
    const rule = createRouteRule(['a'])
    expect(() => RouteRuleSetSchema.parse({
      version: ROUTE_RULE_SET_VERSION,
      rules: Array.from({ length: MAX_ROUTE_RULES + 1 }, () => rule),
    })).toThrow()
  })
})
