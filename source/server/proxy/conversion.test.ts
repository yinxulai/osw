import { describe, expect, it } from 'vitest'
import type { Protocol } from '@common/schemas'
import { convertRequestBody, isConvertible, CONVERTIBLE_PROTOCOLS } from './conversion'
import { convertResponseBody, createSseConverter, parseSseIncremental, serializeSseEvent } from './conversion-response'

function request(protocol: Protocol, body: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ ...body, _protocol: protocol }))
}

function parseBody(buffer: Buffer): Record<string, unknown> {
  return JSON.parse(buffer.toString('utf8'))
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

  it('only rewrites the model on the native path', () => {
    const body = convertRequestBody(
      'openai-completions',
      'openai-completions',
      request('openai-completions', { model: 'client-model', messages: [{ role: 'user', content: 'hi' }], extra: true }),
      'upstream-model',
    )
    const parsed = parseBody(body)
    expect(parsed.model).toBe('upstream-model')
    expect(parsed.extra).toBe(true)
    expect(parsed.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('converts anthropic image blocks to openai image_url parts', () => {
    const body = convertRequestBody(
      'anthropic-messages',
      'openai-completions',
      request('anthropic-messages', {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
          ],
        }],
      }),
      'gpt-test',
    )
    const parsed = parseBody(body)
    expect(parsed.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      ],
    }])
  })

  it('converts openai image_url data URLs to anthropic base64 sources', () => {
    const body = convertRequestBody(
      'openai-completions',
      'anthropic-messages',
      request('openai-completions', {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QkNERUZG' } },
          ],
        }],
      }),
      'claude-test',
    )
    const parsed = parseBody(body)
    expect(parsed.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QkNERUZG' } },
      ],
    }])
  })

  it('defaults anthropic max_tokens to 4096 and joins system messages', () => {
    const body = convertRequestBody(
      'openai-completions',
      'anthropic-messages',
      request('openai-completions', {
        messages: [
          { role: 'system', content: 'first' },
          { role: 'developer', content: 'second' },
          { role: 'user', content: 'hi' },
        ],
      }),
      'claude-test',
    )
    const parsed = parseBody(body)
    expect(parsed.system).toBe('first\n\nsecond')
    expect(parsed.max_tokens).toBe(4096)
  })

  it('maps sampling and stop parameters across protocols', () => {
    const body = convertRequestBody(
      'anthropic-messages',
      'openai-completions',
      request('anthropic-messages', {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 32,
        temperature: 0.2,
        top_p: 0.9,
        stop_sequences: ['END'],
      }),
      'gpt-test',
    )
    const parsed = parseBody(body)
    expect(parsed.temperature).toBe(0.2)
    expect(parsed.top_p).toBe(0.9)
    expect(parsed.stop).toEqual(['END'])
  })

  it('converts plain string responses input to a user message', () => {
    const body = convertRequestBody(
      'openai-responses',
      'openai-completions',
      Buffer.from(JSON.stringify({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'just text' }] }] })),
      'gpt-test',
    )
    const parsed = parseBody(body)
    expect(parsed.messages).toEqual([{ role: 'user', content: 'just text' }])
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

  it('converts openai completion to openai responses', () => {
    const body = convertResponseBody(
      'openai-responses',
      'openai-completions',
      Buffer.from(JSON.stringify({
        id: 'chatcmpl_2',
        model: 'gpt-test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      })),
    )
    const parsed = parseBody(body)
    expect(parsed.object).toBe('response')
    expect(parsed.status).toBe('completed')
    expect(parsed.output).toEqual([{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'answer' }],
    }])
    expect(parsed.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2 })
  })

  it('maps finish reasons across protocols', () => {
    const lengthBody = convertResponseBody(
      'anthropic-messages',
      'openai-completions',
      Buffer.from(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] })),
    )
    expect(parseBody(lengthBody).stop_reason).toBe('max_tokens')

    const toolBody = convertResponseBody(
      'anthropic-messages',
      'openai-completions',
      Buffer.from(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'tool_calls' }] })),
    )
    expect(parseBody(toolBody).stop_reason).toBe('tool_use')

    const maxTokensBody = convertResponseBody(
      'openai-completions',
      'anthropic-messages',
      Buffer.from(JSON.stringify({ content: [], stop_reason: 'max_tokens' })),
    )
    const maxTokensParsed = parseBody(maxTokensBody) as { choices: Array<{ finish_reason: string }> }
    expect(maxTokensParsed.choices[0].finish_reason).toBe('length')
  })

  it('returns the body unchanged when protocols match', () => {
    const body = Buffer.from('{"a":1}')
    expect(convertResponseBody('openai-completions', 'openai-completions', body)).toBe(body)
  })

  it('rejects unsupported directions', () => {
    expect(() =>
      convertResponseBody('anthropic-messages', 'openai-responses', Buffer.from('{}')),
    ).toThrow(/不支持的响应转换方向/)
  })
})

describe('SSE conversion', () => {
  it('parses incremental SSE events', () => {
    const [events, rest] = parseSseIncremental('data: {"a":1}\n\ndata: {"b"')
    expect(events).toEqual([{ event: undefined, data: '{"a":1}' }])
    expect(rest).toBe('data: {"b"')
  })

  it('parses named events and multi-line data', () => {
    const [events, rest] = parseSseIncremental('event: ping\ndata: l1\ndata: l2\n\n')
    expect(events).toEqual([{ event: 'ping', data: 'l1\nl2' }])
    expect(rest).toBe('')
  })

  it('round-trips through serializeSseEvent', () => {
    expect(serializeSseEvent({ event: 'x', data: '1' })).toBe('event: x\ndata: 1\n\n')
    expect(serializeSseEvent({ data: '2' })).toBe('data: 2\n\n')
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

  it('buffers partial chunks split across pushes', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    expect(converter.push('data: {"choices":[{"delta":{"con')).toBe('')
    const out = converter.push('tent":"hi"}}]}\n\n')
    const events = out.split('\n\n').filter(Boolean)
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].replace('data: ', ''))).toEqual({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hi' },
    })
  })

  it('passes through non-JSON events like [DONE]', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    expect(converter.push('data: [DONE]\n\n')).toBe('data: [DONE]\n\n')
  })

  it('flushes a trailing event without a blank line', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    converter.push('data: {"choices":[{"delta":{"content":"tail"}}]}\n\n')
    expect(converter.flush()).toBe('')

    const partial = createSseConverter('anthropic-messages', 'openai-completions')
    partial.push('data: {"choices":[{"delta":{"content":"end"}}]}')
    const tail = partial.flush()
    expect(JSON.parse(tail.replace('data: ', ''))).toEqual({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'end' },
    })
  })

  it('converts openai chunks to openai responses events', () => {
    const converter = createSseConverter('openai-responses', 'openai-completions')
    const out = converter.push(
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\n'
      + 'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":4,"completion_tokens":1}}\n\n',
    )
    const events = out.split('\n\n').filter(Boolean)
    expect(events).toHaveLength(2)
    expect(JSON.parse(events[0].replace('data: ', ''))).toEqual({
      type: 'response.output_text.delta',
      delta: 'he',
    })
    expect(JSON.parse(events[1].replace('data: ', ''))).toEqual({
      type: 'response.completed',
      response: { usage: { prompt_tokens: 4, completion_tokens: 1 } },
    })
  })
})
