import { describe, expect, it } from 'vitest'
import { applyOpenAiCompletionsRequestDefaults } from './request-defaults'

/**
 * OpenAI Chat Completions 请求体默认值。
 *
 * 与 Responses 那边同源：流式请求补 `stream_options.include_usage`，好让上游在最后一帧
 * 把 token 用量一起回给计费/统计。补不上时必须**原样返回**，不能把用户请求改坏。
 */

function apply(payload: unknown): unknown {
  return JSON.parse(applyOpenAiCompletionsRequestDefaults(Buffer.from(JSON.stringify(payload))).toString('utf8'))
}

describe('applyOpenAiCompletionsRequestDefaults', () => {
  it('非流式请求不补用量选项，原样返回同一份 buffer', () => {
    const body = Buffer.from(JSON.stringify({ model: 'gpt-4o', messages: [] }))
    expect(applyOpenAiCompletionsRequestDefaults(body)).toBe(body)
  })

  it('`stream: false` 同样不补（只有严格的 `true` 才算流式）', () => {
    const body = Buffer.from(JSON.stringify({ stream: false, messages: [] }))
    expect(applyOpenAiCompletionsRequestDefaults(body)).toBe(body)
  })

  it('流式且没有 stream_options 时补上一份', () => {
    expect(apply({ model: 'gpt-4o', stream: true })).toEqual({
      model: 'gpt-4o',
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('流式且已有 stream_options 对象时只并入 include_usage，保留其它选项', () => {
    expect(apply({ stream: true, stream_options: { foo: 'bar' } })).toEqual({
      stream: true,
      stream_options: { foo: 'bar', include_usage: true },
    })
  })

  it('已经要过用量时原样返回同一份 buffer', () => {
    const body = Buffer.from(JSON.stringify({ stream: true, stream_options: { include_usage: true } }))
    expect(applyOpenAiCompletionsRequestDefaults(body)).toBe(body)
  })

  it('stream_options 不是对象（字符串 / null）时整块替换', () => {
    expect(apply({ stream: true, stream_options: 'nope' })).toEqual({ stream: true, stream_options: { include_usage: true } })
    expect(apply({ stream: true, stream_options: null })).toEqual({ stream: true, stream_options: { include_usage: true } })
  })

  it('请求体不是 JSON 对象时原样返回', () => {
    const cases = [Buffer.alloc(0), Buffer.from('not json'), Buffer.from('[]'), Buffer.from('null'), Buffer.from('42')]
    for (const body of cases) {
      expect(applyOpenAiCompletionsRequestDefaults(body)).toBe(body)
    }
  })

  it('只补用量，不动请求体里的其它字段', () => {
    const payload = { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }], temperature: 0 }
    expect(apply(payload)).toEqual({ ...payload, stream_options: { include_usage: true } })
  })
})
