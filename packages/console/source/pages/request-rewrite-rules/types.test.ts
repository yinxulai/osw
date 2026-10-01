/**
 * 界面动作 ⇄ 契约动作的映射门禁。
 *
 * 界面把动作压平成 `target`/`operation`/`path`，契约里是按 `type` 判别的联合。所有落点都收在
 * `toUiRuleAction`/`toApiRuleAction` 这一对函数里，加动作类型时最容易漏掉其中一侧，表现为
 * 「保存成了、回读却丢了」或「列表显示对了、保存又变回去」。这里对每种动作做一次双向往返。
 */

import { REWRITE_SCRIPT_TIMEOUT_DEFAULT, REWRITE_SCRIPT_TIMEOUT_LIMIT } from '@common/schemas'
import type { RequestRewriteRuleAction } from '@common/schemas'
import { describe, expect, it } from 'vitest'
import { toApiRuleAction, toUiRuleAction, type RuleAction } from './types'

const roundTrip = (action: RequestRewriteRuleAction) => toApiRuleAction(toUiRuleAction(action, 'draft'))

describe('toUiRuleAction', () => {
  it('脚本动作压平成 target=script，并保留源码与超时', () => {
    const action: RequestRewriteRuleAction = { type: 'script', stage: 'request', code: 'return { body }', timeoutMilliseconds: 250 }
    expect(toUiRuleAction(action, 'a1')).toEqual({
      id: 'a1',
      stage: 'request',
      target: 'script',
      operation: 'set',
      path: '',
      code: 'return { body }',
      timeoutMilliseconds: 250,
    })
  })

  it('结构化动作走原路径，脚本字段不出现在结果里', () => {
    const ui = toUiRuleAction({ type: 'header-set', stage: 'response', name: 'X-Test', value: '1' }, 'a2')
    expect(ui).toMatchObject({ id: 'a2', stage: 'response', target: 'header', operation: 'set', path: 'X-Test', value: '1' })
    expect(ui.code).toBeUndefined()
    expect(ui.timeoutMilliseconds).toBeUndefined()
  })
})

describe('toApiRuleAction', () => {
  it('脚本动作映射回契约并补齐默认超时', () => {
    const ui: RuleAction = { id: 'a1', stage: 'request', target: 'script', operation: 'set', path: '', code: 'return { body }' }
    expect(toApiRuleAction(ui)).toEqual({
      type: 'script',
      stage: 'request',
      code: 'return { body }',
      timeoutMilliseconds: REWRITE_SCRIPT_TIMEOUT_DEFAULT,
    })
  })

  it('脚本缺源码时退回空串（交给契约的 min(1) 拦截）', () => {
    const ui: RuleAction = { id: 'a1', stage: 'response', target: 'script', operation: 'set', path: '' }
    expect(toApiRuleAction(ui)).toEqual({
      type: 'script',
      stage: 'response',
      code: '',
      timeoutMilliseconds: REWRITE_SCRIPT_TIMEOUT_DEFAULT,
    })
  })
})

describe('动作往返', () => {
  const cases: RequestRewriteRuleAction[] = [
    { type: 'script', stage: 'request', code: 'return { headers: { "x-a": "1" } }', timeoutMilliseconds: 500 },
    { type: 'script', stage: 'response', code: 'return { body }', timeoutMilliseconds: REWRITE_SCRIPT_TIMEOUT_LIMIT },
    { type: 'header-set', stage: 'request', name: 'Authorization', value: 'Bearer x' },
    { type: 'header-append', stage: 'response', name: 'X-Trace', value: 'abc' },
    { type: 'header-remove', stage: 'request', name: 'Host' },
    { type: 'body-set', stage: 'request', path: '$.temperature', value: 0 },
    { type: 'body-delete', stage: 'response', path: '$.usage' },
    { type: 'body-replace', stage: 'request', path: '$.model', search: 'a', replacement: 'b', regex: true },
  ]

  it.each(cases)('$type 往返后与契约动作一致', (action) => {
    expect(roundTrip(action)).toEqual(action)
  })
})
