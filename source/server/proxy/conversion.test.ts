import { describe, expect, it } from 'vitest'
import type { Protocol } from '@common/schemas'
import { CONVERTIBLE_PROTOCOLS, isConvertible } from '@common/protocols'
import { convertRequestBody } from './conversion'
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

  it('preserves string content in responses message items', () => {
    const body = convertRequestBody(
      'openai-responses',
      'openai-completions',
      Buffer.from(JSON.stringify({ input: [{ role: 'user', content: 'plain text' }] })),
      'gpt-test',
    )
    const parsed = parseBody(body)
    expect(parsed.messages).toEqual([{ role: 'user', content: 'plain text' }])
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

  it('converts openai chunks to the Anthropic message lifecycle', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    const out = converter.push(
      'data: {"id":"chat-1","model":"gpt-test","choices":[{"delta":{"content":"hi"}}]}\n\n'
      + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\n'
      + 'data: [DONE]\n\n',
    ) + (converter.finish?.() ?? '')
    const events = out.split('\n\n').filter(Boolean).map(item => JSON.parse(item.replace('data: ', '')))
    expect(events.map(event => event.type)).toEqual([
      'message_start', 'content_block_start', 'content_block_delta',
      'content_block_stop', 'message_delta', 'message_stop',
    ])
    expect(events[0].message).toMatchObject({ id: 'chat-1', model: 'gpt-test', role: 'assistant' })
    expect(events[2].delta).toEqual({ type: 'text_delta', text: 'hi' })
    expect(events[4].usage).toEqual({ input_tokens: 2, output_tokens: 2 })
  })

  it('converts streaming OpenAI tool calls to Anthropic tool_use blocks', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    const chunks = [
      { id: 'chat-2', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{\"q\":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '\"x\"}' } }] }, finish_reason: 'tool_calls' }] },
    ]
    const out = chunks.map(chunk => converter.push(`data: ${JSON.stringify(chunk)}\n\n`)).join('') + (converter.finish?.() ?? '')
    const events = out.split('\n\n').filter(Boolean).map(item => JSON.parse(item.replace('data: ', '')))
    expect(events.find(event => event.type === 'content_block_start').content_block).toMatchObject({ type: 'tool_use', id: 'call-1', name: 'lookup' })
    expect(events.filter(event => event.type === 'content_block_delta').map(event => event.delta.partial_json)).toEqual(['{\"q\":', '\"x\"}'])
    expect(events.at(-1).type).toBe('message_stop')
  })

  it('converts Anthropic lifecycle and tool deltas to OpenAI chunks', () => {
    const converter = createSseConverter('openai-completions', 'anthropic-messages')
    const out = converter.push(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","model":"claude-test"}}\n\n'
      + 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"lookup"}}\n\n'
      + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n'
      + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":1,"output_tokens":2}}\n\n',
    )
    const events = out.split('\n\n').filter(Boolean).map(item => JSON.parse(item.replace('data: ', '')))
    expect(events[0].choices[0].delta).toEqual({ role: 'assistant' })
    expect(events[1].choices[0].delta.tool_calls[0]).toMatchObject({ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '' } })
    expect(events[2].choices[0].delta.tool_calls[0].function.arguments).toBe('{\"q\":')
    expect(events[3].choices[0].finish_reason).toBe('tool_calls')
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
    expect(events).toHaveLength(3)
    expect(JSON.parse(events[2].replace('data: ', ''))).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hi' },
    })
  })

  it('consumes OpenAI DONE when producing Anthropic events', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    expect(converter.push('data: [DONE]\n\n')).toBe('')
  })

  it('flushes a trailing event without a blank line', () => {
    const converter = createSseConverter('anthropic-messages', 'openai-completions')
    converter.push('data: {"choices":[{"delta":{"content":"tail"}}]}\n\n')
    expect(converter.flush()).toBe('')

    const partial = createSseConverter('anthropic-messages', 'openai-completions')
    partial.push('data: {"choices":[{"delta":{"content":"end"}}]}')
    const tail = partial.flush()
    const tailEvents = tail.split('\n\n').filter(Boolean)
    expect(JSON.parse(tailEvents[2].replace('data: ', ''))).toEqual({
      type: 'content_block_delta',
      index: 0,
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

describe('tool and edge-case conversions', () => {
  it('maps Anthropic tools and tool results to OpenAI messages', () => {
    const parsed = parseBody(convertRequestBody('anthropic-messages', 'openai-completions', request('anthropic-messages', {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'weather', input: { city: 'Paris' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'sunny' }] },
      ],
      tools: [{ name: 'weather', description: 'get weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
      tool_choice: { type: 'tool', name: 'weather' },
    }), 'gpt-test'))
    expect(parsed.tools).toEqual([{ type: 'function', function: { name: 'weather', description: 'get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }])
    expect(parsed.tool_choice).toEqual({ type: 'function', function: { name: 'weather' } })
    expect(parsed.messages).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'weather', arguments: '{"city":"Paris"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: 'sunny' },
    ])
  })

  it('maps OpenAI tool calls, tool messages, and remote images to Anthropic', () => {
    const parsed = parseBody(convertRequestBody('openai-completions', 'anthropic-messages', request('openai-completions', {
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-2', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] },
        { role: 'tool', tool_call_id: 'call-2', content: 'result' },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] },
      ],
    }), 'claude-test'))
    expect(parsed.messages).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call-2', name: 'lookup', input: { q: 'x' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-2', content: 'result' }] },
      { role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }] },
    ])
  })

  it('maps tool calls in non-streaming responses both ways', () => {
    const anthropic = parseBody(convertResponseBody('anthropic-messages', 'openai-completions', Buffer.from(JSON.stringify({
      id: 'chat-1', choices: [{ message: { content: null, tool_calls: [{ id: 'call-3', function: { name: 'lookup', arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }],
    }))))
    expect(anthropic.content).toEqual([{ type: 'tool_use', id: 'call-3', name: 'lookup', input: { q: 'x' } }])
    const openai = parseBody(convertResponseBody('openai-completions', 'anthropic-messages', Buffer.from(JSON.stringify({
      content: [{ type: 'tool_use', id: 'call-4', name: 'lookup', input: { q: 'x' } }], stop_reason: 'tool_use',
    }))))
    expect(openai.choices).toEqual([{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-4', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }])
  })

  it('parses CRLF SSE, comments, and fields without a space', () => {
    expect(parseSseIncremental(': keepalive\r\nevent:message\r\ndata:{"ok":true}\r\n\r\n')).toEqual([
      [{ event: 'message', data: '{"ok":true}' }], '',
    ])
  })
})
