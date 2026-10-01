import { describe, expect, it } from 'vitest'
import type { RequestRewriteRule, RequestRewriteRuleAction, RuleStage } from '@common/schemas'
import { applyRequestRewriteRules, RequestRewriteError } from './request-rewrite-engine'

const context = (stage: RuleStage = 'request', overrides: Partial<Parameters<typeof applyRequestRewriteRules>[3]> = {}) => ({
  stage,
  clientProtocol: 'openai-completions' as const,
  upstreamProtocol: 'openai-completions' as const,
  ...overrides,
})

function rule(actions: readonly RequestRewriteRuleAction[], overrides: Partial<RequestRewriteRule> = {}): RequestRewriteRule {
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

const requestHeader = (type: 'header-set' | 'header-append' | 'header-remove', name = 'x-test', value = 'value'): RequestRewriteRuleAction =>
  type === 'header-remove' ? { type, stage: 'request', name } : { type, stage: 'request', name, value }

const jsonAction = (action: Record<string, unknown>, stage: RuleStage = 'request') => ({ ...action, stage }) as RequestRewriteRuleAction

function body(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value))
}

function parsed(result: ReturnType<typeof applyRequestRewriteRules>): unknown {
  return JSON.parse(result.body.toString('utf8'))
}

describe('applyRequestRewriteRules', () => {
  it('按规则和动作顺序执行 Header 与 JSON 修改，并更新 content-length', () => {
    const result = applyRequestRewriteRules(
      body({ metadata: { source: 'old' }, text: 'hello' }),
      { 'X-Test': 'before' },
      [rule([
        requestHeader('header-set', 'X-Test', 'after'),
        jsonAction({ type: 'body-set', path: '$.metadata.source', value: 'osw' }),
        jsonAction({ type: 'body-replace', path: '$.text', search: 'hello', replacement: 'hi', regex: false }),
      ])],
      context(),
    )

    expect(result.headers['X-Test']).toBe('after')
    expect(result.headers['content-length']).toBe(String(result.body.length))
    expect(parsed(result)).toEqual({ metadata: { source: 'osw' }, text: 'hi' })
    expect(result.appliedRuleIds).toEqual(['rule-test'])
    expect(result.skippedRuleIds).toEqual([])
  })

  it('支持 Header 追加、大小写不敏感匹配和删除', () => {
    const result = applyRequestRewriteRules(
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
    const requestResult = applyRequestRewriteRules(body({}), {}, [mixed], context('request'))
    const responseResult = applyRequestRewriteRules(body({}), {}, [mixed], context('response', { shape: 'whole' }))
    expect(requestResult.headers['X-Request']).toBe('yes')
    expect(parsed(requestResult)).toEqual({})
    expect(parsed(responseResult)).toEqual({ response: 'yes' })
  })

  it('跳过禁用、已删除、不匹配和没有当前阶段动作的规则', () => {
    const disabled = rule([requestHeader('header-set')], { id: 'disabled', enabled: false })
    const deleted = rule([requestHeader('header-set')], { id: 'deleted', deletedTime: 10 })
    const unmatched = rule([requestHeader('header-set')], { id: 'unmatched', match: { clientProtocols: ['anthropic-messages'], upstreamProtocols: [] } })
    const responseOnly = rule([jsonAction({ type: 'body-set', path: '$.x', value: 1 }, 'response')], { id: 'response-only' })
    const result = applyRequestRewriteRules(body({}), {}, [disabled, deleted, unmatched, responseOnly], context('request'))
    expect(result.appliedRuleIds).toEqual([])
    expect(result.skippedRuleIds).toEqual(['disabled', 'deleted', 'unmatched', 'response-only'])
  })

  it('按客户端和上游协议匹配条件筛选', () => {
    const matching = rule([requestHeader('header-set', 'X-Match', 'yes')], {
      match: { clientProtocols: ['openai-completions'], upstreamProtocols: ['openai-completions'] },
    })
    expect(applyRequestRewriteRules(body({}), {}, [matching], context()).headers['X-Match']).toBe('yes')
    expect(applyRequestRewriteRules(body({}), {}, [matching], context('request', { clientProtocol: 'anthropic-messages' })).appliedRuleIds).toEqual([])
    expect(applyRequestRewriteRules(body({}), {}, [matching], context('request', { upstreamProtocol: 'openai-responses' })).appliedRuleIds).toEqual([])
  })

  it('支持 JSON set 创建对象、delete 和普通字符串 replace', () => {
    const result = applyRequestRewriteRules(body({ text: 'a-b-a', nested: { keep: true } }), {}, [rule([
      jsonAction({ type: 'body-set', path: '$.metadata.source', value: 'test' }),
      jsonAction({ type: 'body-delete', path: '$.nested.keep' }),
      jsonAction({ type: 'body-replace', path: '$.text', search: 'a', replacement: 'x', regex: false }),
    ])], context())
    expect(parsed(result)).toEqual({ text: 'x-b-x', nested: {}, metadata: { source: 'test' } })
  })

  it('支持正则 replace 和捕获组', () => {
    const result = applyRequestRewriteRules(body({ text: 'user:alice user:bob' }), {}, [rule([
      jsonAction({ type: 'body-replace', path: '$.text', search: 'user:(\\w+)', replacement: 'member:$1', regex: true }),
    ])], context())
    expect(parsed(result)).toEqual({ text: 'member:alice member:bob' })
  })

  it('响应流式场景跳过响应动作', () => {
    // 引擎认的是**交付形态**：只有手里拿着一整份正文时，改写才能成立。
    const result = applyRequestRewriteRules(body({ text: 'old' }), {}, [rule([jsonAction({ type: 'body-replace', path: '$.text', search: 'old', replacement: 'new', regex: false }, 'response')])], context('response', { shape: 'incremental' }))
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
  ] as const)('遇到%s时抛出带规则 ID 的 RequestRewriteError', (_label, actions, input) => {
    try {
      applyRequestRewriteRules(Buffer.isBuffer(input) ? input : input, {}, [rule(actions)], context())
      throw new Error('expected error')
    } catch (error) {
      expect(error).toBeInstanceOf(RequestRewriteError)
      expect((error as RequestRewriteError).ruleId).toBe('rule-test')
      expect((error as RequestRewriteError).code).toBe('REQUEST_REWRITE_RULE_FAILED')
    }
  })
})

type ScriptActionOverrides = Partial<Extract<RequestRewriteRuleAction, { type: 'script' }>>

const scriptAction = (code: string, overrides: ScriptActionOverrides = {}): RequestRewriteRuleAction =>
  ({ type: 'script', stage: 'request', code, timeoutMilliseconds: 1000, ...overrides })

describe('applyRequestRewriteRules - script action', () => {
  it('把脚本交回的完整 body 与 headers 整体替换回报文', () => {
    const result = applyRequestRewriteRules(
      body({ temperature: 1, marker: 'apply-strict' }),
      { 'X-Old': 'kept' },
      [rule([scriptAction("return { body: { ...body, temperature: 0 }, headers: { ...headers, 'x-script': 'yes' } }")])],
      context(),
    )
    expect(parsed(result)).toEqual({ temperature: 0, marker: 'apply-strict' })
    expect(result.headers['x-script']).toBe('yes')
    expect(result.headers['X-Old']).toBe('kept')
    expect(result.scriptLogs).toEqual([])
  })

  it('只交回 body 时 headers 保持原样，什么都不交回则整条不改动', () => {
    const onlyBody = applyRequestRewriteRules(body({ a: 1 }), { 'X-Keep': 'yes' }, [rule([scriptAction('return { body: { a: 2 } }')])], context())
    expect(parsed(onlyBody)).toEqual({ a: 2 })
    expect(onlyBody.headers['X-Keep']).toBe('yes')

    const untouched = applyRequestRewriteRules(body({ a: 1 }), { 'X-Keep': 'yes' }, [rule([scriptAction('console.log("no change")')])], context())
    expect(parsed(untouched)).toEqual({ a: 1 })
    expect(untouched.headers['X-Keep']).toBe('yes')
    expect(untouched.scriptLogs).toEqual(['[log] no change'])
  })

  it('交回的 body 是完整内容：没写进去的字段即删除', () => {
    const result = applyRequestRewriteRules(body({ keep: 1, drop: 2, nested: { a: 1, b: 2 } }), {}, [rule([
      scriptAction('return { body: { keep: body.keep } }'),
    ])], context())
    // 顶层与嵌套里没交回的键一并消失——这正是逐键合并做不到的「删字段」。
    expect(parsed(result)).toEqual({ keep: 1 })
  })

  it('正文不是 JSON 时把 null 交给脚本，而不是直接报错', () => {
    const result = applyRequestRewriteRules(Buffer.from('not-json'), {}, [rule([scriptAction('return { body: body === null ? "was-null" : "unexpected" }')])], context())
    expect(result.body.toString('utf8')).toBe(JSON.stringify('was-null'))
  })

  it('脚本抛异常时抛出带规则 ID 的 RequestRewriteError', () => {
    expect(() => applyRequestRewriteRules(body({}), {}, [rule([scriptAction('throw new Error("boom")')])], context()))
      .toThrow(RequestRewriteError)
  })

  it('脚本死循环被超时中断并失败', () => {
    expect(() => applyRequestRewriteRules(body({}), {}, [rule([scriptAction('while (true) {}', { timeoutMilliseconds: 50 })])], context()))
      .toThrow(/timed out/i)
  })

  it.each([
    ['修改受保护 Header', 'return { headers: { Authorization: "x" } }'],
    ['交回非对象', 'return 42'],
    ['改动投递形态字段', 'return { body: { ...body, stream: true } }'],
  ] as const)('脚本%s时失败', (_label, code) => {
    expect(() => applyRequestRewriteRules(body({ stream: false }), {}, [rule([scriptAction(code)])], context()))
      .toThrow(RequestRewriteError)
  })

  it('脚本原样带出 stream 而不改动时不算违规', () => {
    const result = applyRequestRewriteRules(body({ stream: false, a: 1 }), {}, [rule([scriptAction('return { body: { ...body, a: 2 } }')])], context())
    expect(parsed(result)).toEqual({ stream: false, a: 2 })
  })

  it('响应流式场景跳过脚本动作', () => {
    const result = applyRequestRewriteRules(body({ text: 'old' }), {}, [rule([scriptAction('return { body: {} }', { stage: 'response' })])], context('response', { shape: 'incremental' }))
    expect(result.skippedRuleIds).toEqual(['rule-test'])
    expect(parsed(result)).toEqual({ text: 'old' })
    expect(result.scriptLogs).toEqual([])
  })

  it('跳过原因带上「为什么没生效」：每条被跳过的规则都有具名原因', () => {
    const disabled = rule([requestHeader('header-set')], { id: 'disabled', enabled: false })
    const deleted = rule([requestHeader('header-set')], { id: 'deleted', deletedTime: 10 })
    const unmatched = rule([requestHeader('header-set')], { id: 'unmatched', match: { clientProtocols: ['anthropic-messages'], upstreamProtocols: [] } })
    const responseOnly = rule([jsonAction({ type: 'body-set', path: '$.x', value: 1 }, 'response')], { id: 'response-only' })
    const result = applyRequestRewriteRules(body({}), {}, [disabled, deleted, unmatched, responseOnly], context('request'))
    expect(result.skippedRules).toEqual([
      { ruleId: 'disabled', reason: 'disabled' },
      { ruleId: 'deleted', reason: 'deleted' },
      { ruleId: 'unmatched', reason: 'unmatched-protocol' },
      { ruleId: 'response-only', reason: 'no-stage-actions' },
    ])
    // 扁平视图与结构化视图永远同源，不能一处有一套。
    expect(result.skippedRuleIds).toEqual(result.skippedRules.map(item => item.ruleId))
  })

  it('流式响应的跳过原因为 unsupported-shape，而不是笼统的「跳过」', () => {
    const result = applyRequestRewriteRules(body({ text: 'old' }), {}, [rule([jsonAction({ type: 'body-set', path: '$.text', value: 'x' }, 'response')])], context('response', { shape: 'incremental' }))
    expect(result.skippedRules).toEqual([{ ruleId: 'rule-test', reason: 'unsupported-shape' }])
  })

  it('WebSocket（duplex）在响应阶段不适用：直接报错而不是静默跳过', () => {
    // 双向多轮没有「一份响应正文」。能走到这里说明调用方把形态传错了——静默跳过会让试跑
    // 报「改造成功了 0 条」而真实入口回 501，两处对同一份输入给出两个答案。
    expect(() => applyRequestRewriteRules(body({ text: 'old' }), {}, [rule([jsonAction({ type: 'body-set', path: '$.text', value: 'x' }, 'response')])], context('response', { shape: 'duplex' })))
      .toThrow(RequestRewriteError)
  })

  it('响应阶段必须显式给出形态：缺省即抛，不允许悄悄按整包处理', () => {
    expect(() => applyRequestRewriteRules(body({ text: 'old' }), {}, [rule([jsonAction({ type: 'body-set', path: '$.text', value: 'x' }, 'response')])], context('response')))
      .toThrow(RequestRewriteError)
  })

  it('请求阶段无需形态：形态是响应交付才有的概念', () => {
    const result = applyRequestRewriteRules(body({ text: 'old' }), {}, [rule([jsonAction({ type: 'body-set', path: '$.text', value: 'new' })])], context('request'))
    expect(result.appliedRuleIds).toEqual(['rule-test'])
  })

  it('脚本能通过 get() 读取字段并按内容决定是否改动', () => {
    const code = 'if (get("marker") === "apply-strict") return { body: { ...body, temperature: 0 } }'
    const matched = applyRequestRewriteRules(body({ marker: 'apply-strict', temperature: 1 }), {}, [rule([scriptAction(code)])], context())
    expect(parsed(matched)).toEqual({ marker: 'apply-strict', temperature: 0 })
    const missed = applyRequestRewriteRules(body({ temperature: 1 }), {}, [rule([scriptAction(code)])], context())
    expect(parsed(missed)).toEqual({ temperature: 1 })
  })

  it('脚本与结构化动作按列表顺序混合执行，后者看到前者的结果', () => {
    const result = applyRequestRewriteRules(body({ count: 1 }), {}, [rule([
      scriptAction('return { body: { ...body, count: body.count + 10 } }'),
      jsonAction({ type: 'body-set', path: '$.count', value: 100 }),
      scriptAction('return { body: { ...body, count: body.count + 1 } }'),
    ])], context())
    expect(parsed(result)).toEqual({ count: 101 })
    expect(result.scriptLogs).toEqual([])
  })

  it('多条规则的脚本日志按执行顺序累加', () => {
    const first = rule([scriptAction('console.log("first")')], { id: 'first' })
    const second = rule([scriptAction('console.warn("second")', { stage: 'request' })], { id: 'second' })
    const result = applyRequestRewriteRules(body({}), {}, [first, second], context())
    expect(result.scriptLogs).toEqual(['[log] first', '[warn] second'])
    expect(result.appliedRuleIds).toEqual(['first', 'second'])
  })

  it('脚本把 Header 置为 undefined 相当于删除该头，null 归一成空串', () => {
    const result = applyRequestRewriteRules(body({}), { 'X-Drop': 'value', 'X-Blank': 'value', 'X-Keep': 'yes' }, [rule([
      scriptAction('return { headers: { "X-Blank": null, "X-Keep": headers["X-Keep"] } }'),
    ])], context())
    // 删头不必再写 `undefined`：没交回的键直接消失。
    expect(result.headers['X-Drop']).toBeUndefined()
    expect(result.headers['X-Blank']).toBe('')
    expect(result.headers['X-Keep']).toBe('yes')
  })

  it('脚本交回的 Header 是完整集合：整体替换、不区分大小写对齐', () => {
    const result = applyRequestRewriteRules(body({}), { 'X-Test': 'old', 'X-Drop': 'gone' }, [rule([
      scriptAction('return { headers: { "x-test": "new" } }'),
    ])], context())
    expect(result.headers['x-test']).toBe('new')
    expect(result.headers['X-Test']).toBeUndefined()
    expect(result.headers['X-Drop']).toBeUndefined()
    expect(Object.keys(result.headers).filter(key => key.toLowerCase() === 'x-test')).toHaveLength(1)
  })

  it('响应阶段脚本在完整正文上执行，并更新 content-length', () => {
    const result = applyRequestRewriteRules(body({ output: 'old' }), {}, [rule([
      scriptAction('return { body: { output: body.output.toUpperCase() } }', { stage: 'response' }),
    ])], context('response', { shape: 'whole' }))
    expect(parsed(result)).toEqual({ output: 'OLD' })
    expect(result.headers['content-length']).toBe(String(result.body.length))
  })

  it('脚本不得改动投递形态字段，但可以只改 headers 时原样保留 stream', () => {
    const headersOnly = applyRequestRewriteRules(body({ stream: false }), {}, [rule([
      scriptAction('return { headers: { "x-added": "1" } }'),
    ])], context())
    expect(parsed(headersOnly)).toEqual({ stream: false })
    expect(headersOnly.headers['x-added']).toBe('1')
  })

  it('脚本与结构化动作共用受保护 Header 校验：脚本改动即失败', () => {
    expect(() => applyRequestRewriteRules(body({}), {}, [rule([
      scriptAction('return { headers: { "content-length": "0" } }'),
    ])], context())).toThrow(/protected header/i)
  })

  it('脚本返回非法结构（数组 / 数字）时失败', () => {
    expect(() => applyRequestRewriteRules(body({}), {}, [rule([scriptAction('return [1, 2]')])], context()))
      .toThrow(RequestRewriteError)
    expect(() => applyRequestRewriteRules(body({}), {}, [rule([scriptAction('return 7')])], context()))
      .toThrow(RequestRewriteError)
  })
})
