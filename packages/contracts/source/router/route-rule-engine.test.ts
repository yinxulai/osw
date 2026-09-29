import { describe, expect, it } from 'vitest'
import { readLandingModelIds, runWorkflow } from './engine'
import { createDefaultPolicyGraph, samplePayload } from './presets'
import { runRouteRules } from './route-rule-engine'
import {
  ROUTE_RULE_DEFAULT_VARIABLE_PATH,
  ROUTE_RULE_SET_VERSION,
  RouteRuleSetSchema,
  createDefaultRouteRuleSet,
  type RouteRule,
  type RouteRuleCondition,
  type RouteRuleLanding,
  type RouteRuleSet,
} from './route-rules'
import type { RouteContextInput, RuntimeLogicalModel } from './types'

/**
 * 规则表执行器验收。
 *
 * 这里锁的是**顺序语义**：从上往下逐条匹配、第一条既命中又给得出落点的规则胜出、
 * 都不成立才走表级兜底。判定语言本身（各操作符怎么算）已经由 `engine.test.ts` 覆盖，
 * 这里只验证「同一套判定语言在被顺序串起来之后如何决定请求去哪」。
 */

const models: RuntimeLogicalModel[] = [
  { id: 'default', name: 'Default', enabled: true },
  { id: 'model-fast', name: 'Model Fast', enabled: true },
  { id: 'model-smart', name: 'Model Smart', enabled: true },
]

/** 条件：`request.headers.user-agent` 含某个客户端标识。 */
function userAgentCondition(value = 'Cursor', fieldPath = 'request.headers.user-agent'): RouteRuleCondition {
  return {
    fieldPath,
    valueType: 'string',
    operator: 'contains',
    valueSource: 'literal',
    valueFieldPath: '',
    value,
  }
}

function fixedLanding(logicalModelIds: string[]): RouteRuleLanding {
  return { source: 'fixed', logicalModelIds, variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH }
}

/** 造一条规则：默认无条件命中，落到哪由用例自己说。 */
function makeRule(id: string, overrides: Partial<RouteRule> = {}): RouteRule {
  return {
    id,
    name: id,
    enabled: true,
    logicalOperator: 'and',
    conditions: [],
    landing: fixedLanding([]),
    ...overrides,
  }
}

function makeRuleSet(rules: RouteRule[], fallbackModelIds: string[] = []): RouteRuleSet {
  return { version: ROUTE_RULE_SET_VERSION, rules, fallbackModelIds }
}

/** 一次 Cursor 客户端的请求；要改哪一段就改哪一段。 */
function inputOf(overrides: Partial<RouteContextInput> = {}): RouteContextInput {
  return {
    request: {
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'user-agent': 'Cursor/0.42.3 (darwin arm64)' },
      body: { model: 'gpt-4o-mini' },
    },
    logicalModels: models,
    ...overrides,
  }
}

describe('route rule engine', () => {
  it('从上往下匹配，第一条命中的规则胜出并立即停下', () => {
    const ruleSet = makeRuleSet([
      makeRule('r1', { conditions: [userAgentCondition('Claude')], landing: fixedLanding(['model-fast']) }),
      makeRule('r2', { conditions: [userAgentCondition()], landing: fixedLanding(['model-smart']) }),
      // 这一条无条件命中，但排在 r2 后面：顺序即优先级，轮不到它。
      makeRule('r3', { conditions: [], landing: fixedLanding(['default']) }),
    ])

    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBe('r2')
    expect(result.logicalModelIds).toEqual(['model-smart'])
    expect(result.fallback).toBe(false)
    expect(result.stopReason).toBe('rule')
    // 停在 r2，因此 r3 根本没有被判定过：步骤里不该出现一条没发生过的判定。
    expect(result.steps.map(step => step.ruleId)).toEqual(['r1', 'r2'])
    expect(result.steps[0]).toMatchObject({ matched: false, logicalModelIds: [] })
    expect(result.steps[1]).toMatchObject({ matched: true, logicalModelIds: ['model-smart'] })
  })

  it('未启用的规则被跳过，但在步骤里如实留下「被跳过」的痕迹', () => {
    const ruleSet = makeRuleSet([
      makeRule('off', { enabled: false, conditions: [], landing: fixedLanding(['model-fast']) }),
      makeRule('on', { conditions: [], landing: fixedLanding(['model-smart']) }),
    ])

    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBe('on')
    // 停用不是「不成立」，所以步骤里不带条件明细 —— 它根本没有被判定过。
    expect(result.steps[0]).toEqual({
      ruleId: 'off',
      ruleName: 'off',
      enabled: false,
      matched: false,
      logicalModelIds: [],
      conditions: [],
    })
    expect(result.steps[1].enabled).toBe(true)
  })

  it('空条件恒成立，`or` 也不例外', () => {
    // 图的 `or` 语义（「零个条件的 or 永不命中」）在这里不适用：
    // 规则表里「不写条件」的意思就是「无条件命中」，这是「前面的都不匹配就落这里」的写法。
    const ruleSet = makeRuleSet([
      makeRule('catch-all', { logicalOperator: 'or', conditions: [], landing: fixedLanding(['model-fast']) }),
    ])

    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBe('catch-all')
    expect(result.logicalModelIds).toEqual(['model-fast'])
    expect(result.steps[0].conditions).toEqual([])
  })

  it('命中却给不出落点时不算胜出，继续往下匹配', () => {
    const ruleSet = makeRuleSet([
      // 条件成立，但落点是空的：语义是「这条不成立」，而不是在这里再兜一层。
      makeRule('no-landing', { conditions: [userAgentCondition()], landing: fixedLanding([]) }),
      makeRule('next', { conditions: [userAgentCondition()], landing: fixedLanding(['model-fast']) }),
    ])

    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBe('next')
    // 步骤里保留 `matched: true` + 空落点，测试运行才解释得清「为什么没落到这儿」。
    expect(result.steps[0]).toMatchObject({ ruleId: 'no-landing', matched: true, logicalModelIds: [] })
  })

  it('一条都不成立时走表级兜底，落点去重后按顺序给出', () => {
    const ruleSet = makeRuleSet(
      [makeRule('r1', { conditions: [userAgentCondition('Claude')], landing: fixedLanding(['model-smart']) })],
      ['model-fast', 'model-fast', 'model-smart'],
    )

    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBeNull()
    expect(result.fallback).toBe(true)
    expect(result.stopReason).toBe('fallback')
    expect(result.logicalModelIds).toEqual(['model-fast', 'model-smart'])
    expect(result.steps).toHaveLength(1)
  })

  it('变量落点把字段取值直接当逻辑模型 id，读不到就继续往下', () => {
    const passthrough = makeRule('passthrough', {
      landing: { source: 'variable', logicalModelIds: [], variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH },
    })

    const direct = runRouteRules(makeRuleSet([passthrough]), inputOf())
    expect(direct.matchedRuleId).toBe('passthrough')
    expect(direct.logicalModelIds).toEqual(['gpt-4o-mini'])

    // 字段不存在时这条规则给不出落点，于是让给下一条。
    const missing = makeRule('missing', {
      landing: { source: 'variable', logicalModelIds: [], variablePath: 'request.body.not-here' },
    })
    const fallthrough = runRouteRules(
      makeRuleSet([missing, makeRule('next', { landing: fixedLanding(['model-fast']) })]),
      inputOf(),
    )
    expect(fallthrough.matchedRuleId).toBe('next')
  })

  it('条件按名称命中时，变量落点把同一个字段的取值翻译成逻辑模型 id', () => {
    // 「请求模型命中逻辑模型就直连」这条规则的常见写法是条件用 `logicalModels[*].name`
    // （客户端送来的就是模型名），落点再取 `request.body.model`。名称与 id 不同名时
    // （这里是 `deepseek-v4.1-flash` / `deepseek-v4-1-flash`）不能因为两个名字对不上就落到空。
    const logicalModels: RuntimeLogicalModel[] = [
      { id: 'default', name: 'default', enabled: true },
      { id: 'deepseek-v4-1-flash', name: 'deepseek-v4.1-flash', enabled: true },
    ]
    const ruleSet = makeRuleSet([
      makeRule('by-name', {
        conditions: [{
          fieldPath: ROUTE_RULE_DEFAULT_VARIABLE_PATH,
          valueType: 'string',
          operator: 'in',
          valueSource: 'field',
          valueFieldPath: 'logicalModels[*].name',
        }],
        landing: { source: 'variable', logicalModelIds: [], variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH },
      }),
      makeRule('next', { landing: fixedLanding(['default']) }),
    ])

    const result = runRouteRules(ruleSet, {
      ...inputOf(),
      request: { ...inputOf().request, body: { model: 'deepseek-v4.1-flash' } },
      logicalModels,
    })

    expect(result.matchedRuleId).toBe('by-name')
    expect(result.logicalModelIds).toEqual(['deepseek-v4-1-flash'])
    expect(result.steps[0]).toMatchObject({ matched: true, logicalModelIds: ['deepseek-v4-1-flash'] })
  })

  it('取值既是某个逻辑模型的名称、又是另一个的 id 时，id 优先', () => {
    const logicalModels: RuntimeLogicalModel[] = [
      { id: 'model-fast', name: 'Model Fast', enabled: true },
      { id: 'model-smart', name: 'model-fast', enabled: true },
    ]
    const ruleSet = makeRuleSet([
      makeRule('direct', {
        landing: { source: 'variable', logicalModelIds: [], variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH },
      }),
    ])

    const result = runRouteRules(ruleSet, {
      ...inputOf(),
      request: { ...inputOf().request, body: { model: 'model-fast' } },
      logicalModels,
    })

    expect(result.logicalModelIds).toEqual(['model-fast'])
  })

  it('取值既不是逻辑模型 id 也不是名称时原样透传，这条规则仍然胜出', () => {
    // 引擎不替下游筛「认不出的模型」：原样透传、规则照常胜出，由供应商规划回答它存不存在。
    // 只有字段压根取不到值时才给不出落点、让给下一条。
    const ruleSet = makeRuleSet([
      makeRule('passthrough', {
        landing: { source: 'variable', logicalModelIds: [], variablePath: ROUTE_RULE_DEFAULT_VARIABLE_PATH },
      }),
      makeRule('next', { landing: fixedLanding(['model-fast']) }),
    ])

    const result = runRouteRules(ruleSet, {
      ...inputOf(),
      request: { ...inputOf().request, body: { model: 'ghost-model' } },
    })

    expect(result.matchedRuleId).toBe('passthrough')
    expect(result.logicalModelIds).toEqual(['ghost-model'])
  })

  it('条件里的头名大小写不敏感，判定依据如实回传', () => {
    // HTTP 头名本来就大小写不敏感，条件照文档写 `User-Agent` 也必须读得到。
    const ruleSet = makeRuleSet([
      makeRule('ua', { conditions: [userAgentCondition('Cursor', 'request.headers.USER-AGENT')], landing: fixedLanding(['model-fast']) }),
    ])

    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBe('ua')
    // 测试运行要能回答「为什么是这条」，所以判定依据里带上运行时真正读到的值。
    expect(result.steps[0].conditions[0]).toMatchObject({
      fieldPath: 'request.headers.USER-AGENT',
      operator: 'contains',
      actual: 'Cursor/0.42.3 (darwin arm64)',
      matched: true,
    })
  })

  it('协议与传输沿用调用方给出的事实，而不是再猜一遍', () => {
    const result = runRouteRules(
      makeRuleSet([makeRule('r1', { landing: fixedLanding(['model-fast']) })]),
      { ...inputOf(), protocol: 'anthropic-messages', transport: 'http-stream' },
    )

    expect(result.protocol).toBe('anthropic-messages')
    expect(result.transport).toBe('http-stream')
  })

  it('内建默认规则表本身合法，且与内建默认策略给出同一个落点', async () => {
    const ruleSet = createDefaultRouteRuleSet(models)
    expect(RouteRuleSetSchema.safeParse(ruleSet).success).toBe(true)

    const graph = createDefaultPolicyGraph(models)
    for (const model of ['model-fast', 'unknown-model']) {
      const request = { ...samplePayload.request, body: { ...samplePayload.request.body, model } }
      const workflow = await runWorkflow(graph, { request, logicalModels: models })
      const rules = runRouteRules(ruleSet, { request, logicalModels: models })

      // 两种模式要回答的第一个问题是同一个，默认状态下切模式不该改变任何行为。
      expect(rules.logicalModelIds).toEqual(readLandingModelIds(workflow.outputPayload))
    }
  })
})
