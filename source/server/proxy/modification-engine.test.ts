import { describe, expect, it } from 'vitest'
import type { ModificationRule, ModificationRuleAction, RuleStage } from '@common/schemas'
import { applyModificationRules, ModificationError } from './modification-engine'

const context = (stage: RuleStage = 'request', overrides: Partial<Parameters<typeof applyModificationRules>[3]> = {}) => ({
  stage,
  clientProtocol: 'openai-completions' as const,
  upstreamProtocol: 'openai-completions' as const,
  logicalModelId: 'default',
  providerModelId: 'model-1',
  path: '/v1/chat/completions',
  ...overrides,
})

function rule(actions: readonly ModificationRuleAction[], overrides: Partial<ModificationRule> = {}): ModificationRule {
  return {
    id: 'rule-test',
    name: '测试请求修改',
    description: '',
    enabled: true,
    scope: 'model',
    schemaVersion: 1,
    source: 'user',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [...actions],
    testCases: [],
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
    ...overrides,
  }
}

const requestHeader = (type: 'header-set' | 'header-append' | 'header-remove', name = 'x-test', value = 'value'): ModificationRuleAction =>
  type === 'header-remove' ? { type, stage: 'request', name } : { type, stage: 'request', name, value }

const jsonAction = (action: Record<string, unknown>, stage: RuleStage = 'request') => ({ ...action, stage }) as ModificationRuleAction

function body(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value))
}

function parsed(result: ReturnType<typeof applyModificationRules>): unknown {
  return JSON.parse(result.body.toString('utf8'))
}

describe('applyModificationRules', () => {
  it('按规则和动作顺序执行 Header 与 JSON 修改，并更新 content-length', () => {
    const result = applyModificationRules(
      body({ metadata: { source: 'old' }, text: 'hello' }),
      { 'X-Test': 'before' },
      [rule([
        requestHeader('header-set', 'X-Test', 'after'),
        jsonAction({ type: 'body-set', path: '$.metadata.source', value: 'one-switch' }),
        jsonAction({ type: 'body-replace', path: '$.text', search: 'hello', replacement: 'hi', regex: false }),
      ])],
      context(),
    )

    expect(result.headers['X-Test']).toBe('after')
    expect(result.headers['content-length']).toBe(String(result.body.length))
    expect(parsed(result)).toEqual({ metadata: { source: 'one-switch' }, text: 'hi' })
    expect(result.appliedRuleIds).toEqual(['rule-test'])
    expect(result.skippedRuleIds).toEqual([])
  })

  it('支持 Header 追加、大小写不敏感匹配和删除', () => {
    const result = applyModificationRules(
      body({}),
      { 'X-Test': 'one', Remove: 'yes' },
      [rule([requestHeader('header-append', 'x-test', 'two'), requestHeader('header-remove', 'REMOVE')])],
      context(),
    )
    expect(result.headers['X-Test']).toBe('one, two')
    expect(result.headers.Remove).toBeUndefined()
  })

  it('支持同一规则同时执行请求和响应动作', () => {
    const mixed = rule([
      requestHeader('header-set', 'X-Request', 'yes'),
      jsonAction({ type: 'body-set', path: '$.response', value: 'yes' }, 'response'),
    ])
    const requestResult = applyModificationRules(body({}), {}, [mixed], context('request'))
    const responseResult = applyModificationRules(body({}), {}, [mixed], context('response'))
    expect(requestResult.headers['X-Request']).toBe('yes')
    expect(parsed(requestResult)).toEqual({})
    expect(parsed(responseResult)).toEqual({ response: 'yes' })
  })

  it('跳过禁用、已删除、不匹配和没有当前阶段动作的规则', () => {
    const disabled = rule([requestHeader('header-set')], { id: 'disabled', enabled: false })
    const deleted = rule([requestHeader('header-set')], { id: 'deleted', deletedTime: 10 })
    const unmatched = rule([requestHeader('header-set')], { id: 'unmatched', match: { clientProtocols: ['anthropic-messages'], upstreamProtocols: [] } })
    const responseOnly = rule([jsonAction({ type: 'body-set', path: '$.x', value: 1 }, 'response')], { id: 'response-only' })
    const result = applyModificationRules(body({}), {}, [disabled, deleted, unmatched, responseOnly], context('request'))
    expect(result.appliedRuleIds).toEqual([])
    expect(result.skippedRuleIds).toEqual(['disabled', 'deleted', 'unmatched', 'response-only'])
  })

  it('按 protocol、路径、逻辑模型和供应商模型匹配条件筛选', () => {
    const matching = rule([requestHeader('header-set', 'X-Match', 'yes')], {
      match: { clientProtocols: ['openai-completions'], upstreamProtocols: ['openai-completions'], path: '/v1/chat/completions', logicalModelId: 'default', providerModelId: 'model-1' },
    })
    expect(applyModificationRules(body({}), {}, [matching], context()).headers['X-Match']).toBe('yes')
    expect(applyModificationRules(body({}), {}, [matching], context('request', { path: '/v1/responses' })).appliedRuleIds).toEqual([])
    expect(applyModificationRules(body({}), {}, [matching], context('request', { clientProtocol: 'anthropic-messages' })).appliedRuleIds).toEqual([])
  })

  it('支持 JSON set 创建对象、delete 和普通字符串 replace', () => {
    const result = applyModificationRules(body({ text: 'a-b-a', nested: { keep: true } }), {}, [rule([
      jsonAction({ type: 'body-set', path: '$.metadata.source', value: 'test' }),
      jsonAction({ type: 'body-delete', path: '$.nested.keep' }),
      jsonAction({ type: 'body-replace', path: '$.text', search: 'a', replacement: 'x', regex: false }),
    ])], context())
    expect(parsed(result)).toEqual({ text: 'x-b-x', nested: {}, metadata: { source: 'test' } })
  })

  it('支持正则 replace 和捕获组', () => {
    const result = applyModificationRules(body({ text: 'user:alice user:bob' }), {}, [rule([
      jsonAction({ type: 'body-replace', path: '$.text', search: 'user:(\\w+)', replacement: 'member:$1', regex: true }),
    ])], context())
    expect(parsed(result)).toEqual({ text: 'member:alice member:bob' })
  })

  it('响应流式场景跳过响应动作', () => {
    const result = applyModificationRules(body({ text: 'old' }), {}, [rule([jsonAction({ type: 'body-replace', path: '$.text', search: 'old', replacement: 'new', regex: false }, 'response')])], context('response', { streaming: true }))
    expect(result.appliedRuleIds).toEqual([])
    expect(result.skippedRuleIds).toEqual(['rule-test'])
    expect(parsed(result)).toEqual({ text: 'old' })
  })

  it.each([
    ['受保护 Header', [requestHeader('header-set', 'Authorization')], body({})],
    ['无效 JSON', [jsonAction({ type: 'body-set', path: '$.x', value: 1 })], Buffer.from('not-json')],
    ['无效 Body 路径', [jsonAction({ type: 'body-set', path: 'x', value: 1 })], body({})],
    ['Body 路径不匹配', [jsonAction({ type: 'body-delete', path: '$.missing.value' })], body({})],
    ['替换目标不是字符串', [jsonAction({ type: 'body-replace', path: '$.value', search: 'a', replacement: 'b', regex: false })], body({ value: 1 })],
    ['空替换内容', [jsonAction({ type: 'body-replace', path: '$.value', search: '', replacement: 'b', regex: false })], body({ value: 'a' })],
    ['无效正则', [jsonAction({ type: 'body-replace', path: '$.value', search: '[', replacement: 'b', regex: true })], body({ value: 'a' })],
  ] as const)('遇到%s时抛出带规则 ID 的 ModificationError', (_label, actions, input) => {
    try {
      applyModificationRules(Buffer.isBuffer(input) ? input : input, {}, [rule(actions)], context())
      throw new Error('expected error')
    } catch (error) {
      expect(error).toBeInstanceOf(ModificationError)
      expect((error as ModificationError).ruleId).toBe('rule-test')
      expect((error as ModificationError).code).toBe('MODIFICATION_RULE_FAILED')
    }
  })
})
