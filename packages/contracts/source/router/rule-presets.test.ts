import { describe, expect, it } from 'vitest'
import { createPresetModelPool, samplePayload } from './presets'
import { runRouteRules } from './route-rule-engine'
import { createDefaultRouteRuleSet, isSameRouteRuleSet, MAX_ROUTE_RULES, ROUTE_RULE_FIELD_KINDS, RouteRuleSetSchema, type RouteRuleSet } from './route-rules'
import { findRulePreset, ROUTER_RULE_PRESETS } from './rule-presets'
import type { RuntimeLogicalModel, WorkflowProtocol } from './types'

/**
 * 内置规则预设验收。
 *
 * 图侧预设的验收（`presets.test.ts`）锁的是「跑起来落到哪」；规则表这边除了同一件事，
 * 还要锁住三条**只有清单模式才有**的性质：
 *
 * - 规则 id 固定 —— 菜单「当前套的是哪一个」靠 `isSameRouteRuleSet` 逐字节比 JSON，
 *   随机 id 会让高亮永远失效；
 * - 落点在生成时就是真实存在的逻辑模型（套用即能跑，不留死分支）；
 * - 每条规则读的路径都是**规则表来源表里读得到的**（列一个取不到值的字段 = 一条永不命中的分支）。
 */

const models: RuntimeLogicalModel[] = [
  { modelId: 'default', enabled: true },
  { modelId: 'model-fast', enabled: true },
  { modelId: 'model-smart', enabled: true },
]

const presetRuleSets = ROUTER_RULE_PRESETS.map(preset => ({ id: preset.id, ruleSet: preset.createRuleSet(models) }))

/** 规则表里所有落点（每条规则 + 表级兜底）用到的逻辑模型 id。 */
function landingIdsOf(ruleSet: RouteRuleSet): string[] {
  return [...ruleSet.rules.flatMap(rule => rule.landing.logicalModelIds), ...ruleSet.fallbackModelIds]
}

describe('内置规则预设清单', () => {
  it('id 唯一，只有一个默认项，且默认项排在第一个', () => {
    const ids = ROUTER_RULE_PRESETS.map(preset => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ROUTER_RULE_PRESETS[0].isDefault).toBe(true)
    expect(ROUTER_RULE_PRESETS.filter(preset => preset.isDefault)).toHaveLength(1)
  })

  it('每个预设都能通过规则表 schema，规则条数不超上限', () => {
    for (const { id, ruleSet } of presetRuleSets) {
      expect(RouteRuleSetSchema.safeParse(ruleSet).success, id).toBe(true)
      expect(ruleSet.rules.length, id).toBeLessThanOrEqual(MAX_ROUTE_RULES)
      expect(ruleSet.rules.length, id).toBeGreaterThan(0)
    }
  })

  it('规则 id 在表内唯一且固定：同一份逻辑模型生成两次逐字节相同', () => {
    for (const preset of ROUTER_RULE_PRESETS) {
      const first = preset.createRuleSet(models)
      const second = preset.createRuleSet(models)
      const ids = first.rules.map(rule => rule.id)

      expect(new Set(ids).size, preset.id).toBe(ids.length)
      expect(isSameRouteRuleSet(first, second), preset.id).toBe(true)
    }
  })

  it('findRulePreset 按 id 找到预设，未知 id 返回 undefined', () => {
    expect(findRulePreset('client-source')?.id).toBe('client-source')
    expect(findRulePreset('nope')).toBeUndefined()
  })

  it('默认预设就是内建默认规则表本身', () => {
    const preset = ROUTER_RULE_PRESETS.find(item => item.isDefault)

    expect(preset?.id).toBe('model-direct')
    expect(isSameRouteRuleSet(preset!.createRuleSet(models), createDefaultRouteRuleSet(models))).toBe(true)
  })

  it('每条规则读的路径都属于规则表自己的来源表（不留永远取不到值的条件）', () => {
    // 规则模式没有协议解析器，能读的只有来源表里两条口径：
    // (a) `needsName === false` 那些**本身就是完整路径**的来源；
    // (b) `request.headers.<名字>` —— 头名与请求体形状无关，引擎给的是整个 `request.headers`，
    //     取哪一条头不会因为协议不同而读不到；请求体字段名则不行（`messages` 只在部分协议里存在）。
    // 前綴从来源表**派生**而不是手拄：来源表换了前缀，这里跟着变，不会留一份过期的白名单。
    const completePaths = new Set(ROUTE_RULE_FIELD_KINDS.filter(meta => !meta.needsName).map(meta => meta.prefix))
    const headerPrefix = ROUTE_RULE_FIELD_KINDS.find(meta => meta.kind === 'header')?.prefix ?? ''

    for (const { id, ruleSet } of presetRuleSets) {
      for (const rule of ruleSet.rules) {
        for (const condition of rule.conditions) {
          const readablePath = completePaths.has(condition.fieldPath)
            || (headerPrefix !== '' && condition.fieldPath.startsWith(headerPrefix))
          expect(readablePath, `${id}/${rule.id}/${condition.fieldPath}`).toBe(true)
        }
      }
    }
  })
})

describe('内置规则预设的落点', () => {
  it('每个预设的落点都是这次可见的逻辑模型', () => {
    const visibleIds = new Set(models.map(model => model.modelId))

    for (const { id, ruleSet } of presetRuleSets) {
      for (const landingId of landingIdsOf(ruleSet)) {
        expect(visibleIds.has(landingId), `${id}/${landingId}`).toBe(true)
      }
    }
  })

  it('只剩一个已启用模型时每条分支都落到它，不留空落点', () => {
    const single: RuntimeLogicalModel[] = [{ modelId: 'default', enabled: true }]

    for (const preset of ROUTER_RULE_PRESETS) {
      const ruleSet = preset.createRuleSet(single)

      expect(landingIdsOf(ruleSet).every(landingId => landingId === 'default'), preset.id).toBe(true)
      expect(ruleSet.fallbackModelIds, preset.id).toEqual(['default'])
    }
  })

  it('一个可用模型都没有时落点为空，而不是写死一个不存在的 id', () => {
    for (const preset of ROUTER_RULE_PRESETS) {
      const ruleSet = preset.createRuleSet([])

      expect(landingIdsOf(ruleSet), preset.id).toEqual([])
    }
  })

  it('兜底落点取内建默认逻辑模型，分流落点取兜底之外的其他模型', () => {
    const pool = createPresetModelPool(models)

    for (const { id, ruleSet } of presetRuleSets) {
      expect(ruleSet.fallbackModelIds, id).toEqual([pool.fallbackModelId])
    }
    // 非默认预设的第一条分流规则指向第一个分流落点，而不是兜底。
    expect(presetRuleSets.find(item => item.id === 'client-source')!.ruleSet.rules[0].landing.logicalModelIds).toEqual([pool.landingModelIds[0]])
  })
})

describe('内置规则预设的运行行为', () => {
  // 协议由调用方作为**确凿事实**传入（代理入口本来就知道客户端用的是什么协议），
  // 引擎不从头猜；示例请求照它的 path 声明为 chat completions。
  const inputOf = (protocol: WorkflowProtocol = 'openai-completions') => ({ request: samplePayload.request, logicalModels: models, protocol })

  it.each(presetRuleSets.map(item => [item.id, item.ruleSet] as const))('%s 在示例请求下都能给出落点', (_id, ruleSet) => {
    const result = runRouteRules(ruleSet, inputOf())

    expect(result.logicalModelIds.length).toBeGreaterThan(0)
  })

  it('客户端来源预设：示例请求的 Cursor UA 命中第一条规则', () => {
    const ruleSet = findRulePreset('client-source')!.createRuleSet(models)
    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBe('rule-client-cursor')
    expect(result.fallback).toBe(false)
  })

  it('模型名预设：gpt-4o-mini 命中 OpenAI 那条，而不是 Claude 那条', () => {
    const ruleSet = findRulePreset('model-prefix')!.createRuleSet(models)
    const result = runRouteRules(ruleSet, inputOf())

    expect(result.matchedRuleId).toBe('rule-model-openai')
  })

  it('模型名预设：claude 前缀（带日期后缀）命中 Claude 那条', () => {
    const ruleSet = findRulePreset('model-prefix')!.createRuleSet(models)
    const result = runRouteRules(ruleSet, {
      ...inputOf(),
      request: { ...samplePayload.request, body: { ...samplePayload.request.body, model: 'claude-3-5-sonnet-20241022' } },
    })

    expect(result.matchedRuleId).toBe('rule-model-claude')
  })

  it('模型名预设：不含这两个前缀的模型走兜底', () => {
    const ruleSet = findRulePreset('model-prefix')!.createRuleSet(models)
    const result = runRouteRules(ruleSet, {
      ...inputOf(),
      request: { ...samplePayload.request, body: { ...samplePayload.request.body, model: 'my-local-model' } },
    })

    expect(result.matchedRuleId).toBeNull()
    expect(result.fallback).toBe(true)
  })

  it('协议预设：示例请求是 chat completions，两条协议规则都不命中，走兜底', () => {
    const ruleSet = findRulePreset('protocol-routing')!.createRuleSet(models)
    const result = runRouteRules(ruleSet, inputOf())

    expect(result.protocol).toBe('openai-completions')
    expect(result.matchedRuleId).toBeNull()
    expect(result.fallback).toBe(true)
  })

  it('协议预设：anthropic 请求命中 Anthropic 那条', () => {
    const ruleSet = findRulePreset('protocol-routing')!.createRuleSet(models)
    const result = runRouteRules(ruleSet, {
      ...inputOf('anthropic-messages'),
      request: { ...samplePayload.request, path: '/v1/messages' },
    })

    expect(result.protocol).toBe('anthropic-messages')
    expect(result.matchedRuleId).toBe('rule-protocol-anthropic')
  })
})
