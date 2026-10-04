import { describe, expect, it } from 'vitest'
import {
  SHARED_REWRITE_RULES_DEFAULT_LIST_LIMIT,
  SHARED_REWRITE_RULES_MAX_LIST_LIMIT,
  SharedRewriteRuleListInputSchema,
  SharedRewriteRuleListResultSchema,
  SharedRewriteRulePayloadSchema,
  SharedRewriteRulePublishInputSchema,
  SharedRewriteRuleSchema,
  sharedRewriteRuleDisabledReason,
  type SharedRewriteRulePayload,
} from './shared-rewrite-rules'

function payload(overrides: Partial<SharedRewriteRulePayload> = {}): SharedRewriteRulePayload {
  return {
    name: 'Override User-Agent',
    description: 'Send a fixed User-Agent upstream',
    scope: 'model',
    schemaVersion: 1,
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ type: 'header-set', stage: 'request', name: 'user-agent', value: 'OSW' }],
    testCases: [],
    ...overrides,
  }
}

describe('共享重写规则载荷', () => {
  it('接受一条最小规则，并把可选字段补成默认值', () => {
    const parsed = SharedRewriteRulePayloadSchema.parse({
      name: 'Override User-Agent',
      scope: 'global',
      actions: [{ type: 'header-remove', stage: 'request', name: 'cookie' }],
    })

    expect(parsed.description).toBe('')
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.match).toEqual({ clientProtocols: [], upstreamProtocols: [] })
    expect(parsed.testCases).toEqual([])
  })

  // 载荷刻意不含存储事实与本地状态：带上它们等于让作者决定 `id`、让一条规则带上别人的
  // 启用状态与来源标注。
  it('拒绝夹带存储事实的字段', () => {
    const result = SharedRewriteRulePayloadSchema.safeParse({ ...payload(), id: 'rule_x' })

    expect(result.success).toBe(false)
  })

  it('一条动作都没有的规则不成立', () => {
    const result = SharedRewriteRulePayloadSchema.safeParse({ ...payload(), actions: [] })

    expect(result.success).toBe(false)
  })
})

describe('共享重写规则记录', () => {
  it('在载荷之上补上 id 与用量计数', () => {
    const record = SharedRewriteRuleSchema.parse({
      ...payload(),
      id: 'sha256-abc',
      usageCount: 7,
      createdTime: 1_700_000_000_000,
      updatedTime: 1_700_000_000_000,
    })

    expect(record.id).toBe('sha256-abc')
    expect(record.usageCount).toBe(7)
  })

  it('用量计数不能是负数', () => {
    const result = SharedRewriteRuleSchema.safeParse({
      ...payload(),
      id: 'sha256-abc',
      usageCount: -1,
      createdTime: 0,
      updatedTime: 0,
    })

    expect(result.success).toBe(false)
  })
})

describe('列表查询', () => {
  it('不带参数时用默认排序与默认分页', () => {
    const input = SharedRewriteRuleListInputSchema.parse({})

    expect(input.sort).toBe('popular')
    expect(input.query).toBe('')
    expect(input.limit).toBe(SHARED_REWRITE_RULES_DEFAULT_LIST_LIMIT)
    expect(input.offset).toBe(0)
  })

  it('拒绝超过服务端硬上限的 limit', () => {
    const result = SharedRewriteRuleListInputSchema.safeParse({ limit: SHARED_REWRITE_RULES_MAX_LIST_LIMIT + 1 })

    expect(result.success).toBe(false)
  })

  it('列表结果带着总量，界面据此判断还有没有下一页', () => {
    const result = SharedRewriteRuleListResultSchema.parse({
      rules: [{ ...payload(), id: 'a', usageCount: 0, createdTime: 0, updatedTime: 0 }],
      total: 41,
      limit: 30,
      offset: 0,
    })

    expect(result.total).toBe(41)
  })
})

describe('发布', () => {
  it('接受一个包着规则的发布请求', () => {
    const parsed = SharedRewriteRulePublishInputSchema.parse({ rule: payload() })

    expect(parsed.rule.name).toBe('Override User-Agent')
  })
})

describe('响应阶段闸门', () => {
  // 与 `@common/features` 的 `RESPONSE_REWRITE_ENABLED` 同源：目录必须用同一道闸门，
  // 否则会出现「能发布、但装回来存不下」的规则。
  it('响应阶段动作不可发布', () => {
    const reason = sharedRewriteRuleDisabledReason(payload({
      actions: [{ type: 'header-remove', stage: 'response', name: 'x-request-id' }],
    }))

    expect(reason).toContain('Response-stage actions')
  })

  it('响应阶段用例不可发布', () => {
    const reason = sharedRewriteRuleDisabledReason(payload({
      testCases: [{ id: 't1', name: 'sample', stage: 'response', body: '{}', headers: '{}', clientProtocol: 'openai-completions', upstreamProtocol: 'openai-completions', transport: 'http' }],
    }))

    expect(reason).toContain('Response-stage test cases')
  })

  it('纯请求阶段的规则照常放行', () => {
    expect(sharedRewriteRuleDisabledReason(payload())).toBeNull()
  })
})
