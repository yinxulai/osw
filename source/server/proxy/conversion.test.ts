import { describe, expect, it } from 'vitest'
import type { Protocol } from '@common/schemas'
import { convertRequestBody, isConvertible, CONVERTIBLE_PROTOCOLS } from './conversion'
import { convertResponseBody, createSseConverter, parseSseIncremental } from './conversion-response'

function request(protocol: Protocol, body: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ ...body, _protocol: protocol }))
}

describe('isConvertible', () => {
  it('matches the registered conversion directions', () => {
    expect(isConvertible('openai-completions', 'anthropic-messages')).toBe(true)
    expect(isConvertible('openai-completions', 'openai-responses')).toBe(true)
    expect(isConvertible('anthropic-messages', 'openai-completions')).toBe(true)
    expect(isConvertible('openai-responses', 'anthropic-messages')).toBe(false)
    expect(isConvertible('openai-completions', 'openai-completions')).toBe(false)
    expect(Object.keys(CONVERTIBLE_PROTOCOLS)).toHaveLength(3)
  })
})

describe('convertRequestBody', () => {
  it('converts anthropic messages to openai completions', () => {
    const body = convertRequestBody(
      'anthropic-messages',
      'openai-completions',
      request('anthropic-messages', {
        system: 'be brief',
        max_tokens: 128,
        stream: true,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: 'hi' },
        ],
      }),
      'gpt-test',
    )
    const parsed = JSON.parse(body.toString('utf8'))
    expect(parsed.model).toBe('gpt-test')
    expect(parsed.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
    expect(parsed.max_tokens).toBe(128)
    expect(parsed.stream).toBe(true)
  })

  it('converts openai responses to openai completions', () => {
    const body = convertRequestBody(
      'openai-responses',
      'openai-completions',
      request('openai-responses', {
        instructions: 'sys',
        max_output_tokens: 64,
        input: [
          { role: 'user', content: [{ type: 'input_text', text: 'q' }] },
        ],
      }),
      'gpt-test',
    )
    const parsed = JSON.parse(body.toString('utf8'))
    expect(parsed.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
    ])
    expect(parsed.max_tokens).toBe(64)
  })

  it('converts openai completions to anthropic messages', () => {
    const body = convertRequestBody(
      'openai-completions',
      'anthropic-messages',
      request('openai-completions', {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        max_tokens: 100,
      }),
      'claude-test',
    )
    const parsed = JSON.parse(body.toString('utf8'))
    expect(parsed.model).toBe('claude-test')
    expect(parsed.system).toBe('sys')
    expect(parsed.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(parsed.max_tokens).toBe(100)
  })

  it('rejects unsupported directions', () => {
    expect(() =>
      convertRequestBody('openai-responses', 'anthropic-messages', Buffer.from('{}'), 'm'),
    ).toThrow(/不支持的协议转换方向/)
  })
})

describe('convertResponseBody', () => {
  it('converts openai completion to anthropic message', () => {
    const body = convertResponseBody(
      'anthropic-messages',
      'openai-completions',
      Buffer.from(JSON.stringify({
        id: 'chatcmpl-1',
        model: 'gpt-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } },
      })),
    )
    const parsed = JSON.parse(body.toString('utf8'))
    expect(parsed.type).toBe('message')
    expect(parsed.role).toBe('assistant')
    expect(parsed.content).toEqual([{ type: 'text', text: 'answer' }])
    expect(parsed.stop_reason).toBe('end_turn')
    expect(parsed.usage).toEqual({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 })
  })

  it('converts anthropic message to openai completion', () => {
    const body = convertResponseBody(
      'openai-completions',
      'anthropic-messages',
      Buffer.from(JSON.stringify({
        id: 'msg_1',
        model: 'claude-test',
        content: [{ type: 'text', text: 'answer' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 4 },
      })),
    )
    const parsed = JSON.parse(body.toString('utf8'))
    expect(parsed.object).toBe('chat.completion')
    expect(parsed.choices[0].message.content).toBe('answer')
    expect(parsed.choices[0].finish_reason).toBe('stop')
    expect(parsed.usage).toEqual({ prompt_tokens: 7, completion_tokens: 4 })
  })
})

describe('SSE conversion', () => {
  it('parses incremental SSE events', () => {
    const [events, rest] = parseSseIncremental('data: {"a":1}\n\ndata: {"b"')
    expect(events).toEqual([{ event: undefined, data: '{"a":1}' }])
    expect(rest).toBe('data: {"b"')
  })

  it('converts openai chunks to anthropic events', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    const out = converter.push(
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\n'
      + 'data: {"choices":[{"delta":{"content":"y"}}]}\n\n'
      + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n',
    )
    const events = out.split('\n\n').filter(Boolean)
    expect(events).toHaveLength(3)
    expect(JSON.parse(events[0].replace('data: ', ''))).toEqual({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'he' },
    })
    expect(JSON.parse(events[2].replace('data: ', '')).usage).toEqual({
      input_tokens: 2,
      output_tokens: 2,
    })
  })

  it('converts anthropic events to openai chunks and appends DONE on flush', () => {
    const converter = createSseConverter('openai-completions', 'anthropic-messages')
    const out = converter.push(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"yo"}}\n\n'
      + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":1,"output_tokens":1}}\n\n',
    )
    const events = out.split('\n\n').filter(Boolean)
    expect(events).toHaveLength(2)
    expect(JSON.parse(events[0].replace('data: ', '')).choices[0].delta.content).toBe('yo')
    expect(JSON.parse(events[1].replace('data: ', '')).usage).toEqual({
      prompt_tokens: 1,
      completion_tokens: 1,
    })
  })

  it('passes through when protocols match', () => {
    const converter = createSseConverter('openai-completions', 'openai-completions')
    expect(converter.push('data: x\n\n')).toBe('data: x\n\n')
    expect(converter.flush()).toBe('')
  })
})
