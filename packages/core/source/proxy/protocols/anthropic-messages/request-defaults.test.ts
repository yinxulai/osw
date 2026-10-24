import { describe, expect, it } from 'vitest'
import { applyAnthropicMessagesRequestDefaults } from './request-defaults'

/**
 * Anthropic Messages 请求体默认值。
 *
 * `max_tokens` 在这个协议里是**必填**的，上游缺了它直接回 400。代理只负责在客户端没写时
 * 补一个值，其它情况一律原样返回——尤其不能覆盖用户自己填的 `0` 或空值语义。
 */

function apply(payload: unknown): unknown {
  return JSON.parse(applyAnthropicMessagesRequestDefaults(Buffer.from(JSON.stringify(payload))).toString('utf8'))
}

describe('applyAnthropicMessagesRequestDefaults', () => {
  it('缺 max_tokens 时补 4096', () => {
    expect(apply({ model: 'claude-sonnet-4', messages: [] })).toEqual({
      model: 'claude-sonnet-4',
      messages: [],
      max_tokens: 4096,
    })
  })

  it('已经有 max_tokens 时原样返回同一份 buffer（不重排、不重编码）', () => {
    const body = Buffer.from(JSON.stringify({ model: 'claude-sonnet-4', max_tokens: 1024 }))
    expect(applyAnthropicMessagesRequestDefaults(body)).toBe(body)
  })

  it('`max_tokens: 0` 算用户写过了，不被当成缺失', () => {
    // 判定用的是 `!== undefined && !== null`，`0` 是合法取值（虽然上游多半会拒绝），
    // 代理不该替用户改数。用真值判断就会出现这个坑。
    const body = Buffer.from(JSON.stringify({ max_tokens: 0 }))
    expect(applyAnthropicMessagesRequestDefaults(body)).toBe(body)
  })

  it('`max_tokens: null` 视为缺失，补上 4096', () => {
    expect(apply({ max_tokens: null })).toEqual({ max_tokens: 4096 })
  })

  it('请求体不是 JSON 对象时原样返回', () => {
    const cases = [Buffer.alloc(0), Buffer.from('not json'), Buffer.from('[]'), Buffer.from('null'), Buffer.from('42'), Buffer.from('"text"')]
    for (const body of cases) {
      expect(applyAnthropicMessagesRequestDefaults(body)).toBe(body)
    }
  })

  it('只补 max_tokens，不动其它字段', () => {
    const payload = { model: 'claude-sonnet-4', stream: true, system: 'be terse', messages: [{ role: 'user', content: 'hi' }] }
    expect(apply(payload)).toEqual({ ...payload, max_tokens: 4096 })
  })
})
