import { describe, expect, it } from 'vitest'
import {
  createOpenAiToAnthropicState,
  finishOpenAiToAnthropic,
  openAiChunkToAnthropicEvents,
  openAiResponseToAnthropic,
} from './response-conversion-openai-to-anthropic'

describe('openAiResponseToAnthropic', () => {
  it('converts tool calls, malformed arguments, stop reason, and usage', () => {
    const result = openAiResponseToAnthropic({
      id: 'chat_1',
      model: 'gpt',
      choices: [{
        message: {
          content: 'Checking',
          tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{bad' } }],
        },
        finish_reason: 'content_filter',
      }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
      },
    })

    expect(result).toEqual({
      id: 'chat_1',
      type: 'message',
      role: 'assistant',
      model: 'gpt',
      content: [
        { type: 'text', text: 'Checking' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 6, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 },
    })
  })

  it('maps a content filter finish to refusal without tool calls', () => {
    const result = openAiResponseToAnthropic({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })
    expect(result.stop_reason).toBe('refusal')
  })

  it('joins array-style content parts and tolerates a missing choice', () => {
    const parts = openAiResponseToAnthropic({
      choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, finish_reason: 'stop' }],
    })
    expect(parts.content).toEqual([{ type: 'text', text: 'ab' }])

    const empty = openAiResponseToAnthropic({})
    expect(empty).toMatchObject({ id: '', model: '', content: [], stop_reason: 'end_turn' })
    expect(empty.usage).toBeUndefined()
  })

  it('floors the uncached input count when cache details exceed the prompt total', () => {
    // 异常数据（cached > prompt_tokens）按约定的 0 下限处理，不允许出现负数 input_tokens
    const result = openAiResponseToAnthropic({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 7 } },
    })

    expect(result.usage).toEqual({ input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 7 })
  })

  it('prefers responses-style counts when chat usage fields are placeholder zeros', () => {
    // 聚合网关把两套字段塞进同一个 usage：Chat 的 prompt_tokens / completion_tokens /
    // prompt_tokens_details.cached_tokens 是占位 0，真实值在 input_tokens / output_tokens /
    // input_tokens_details.cached_tokens。停在第一个数字上会把客户端看到的用量写成全 0。
    // Anthropic 的 input_tokens 只计未缓存输入，所以 30 要扣掉缓存 12。
    const result = openAiResponseToAnthropic({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 },
        input_tokens: 30,
        output_tokens: 4,
        input_tokens_details: { cached_tokens: 12 },
      },
    })

    expect(result.usage).toEqual({ input_tokens: 18, output_tokens: 4, cache_read_input_tokens: 12 })
  })

  it('keeps a reported zero when every usage candidate is zero', () => {
    const result = openAiResponseToAnthropic({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 },
        input_tokens: 0,
        output_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
      },
    })

    expect(result.usage).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 })
  })

  it('still subtracts cached tokens from a positive prompt total', () => {
    const result = openAiResponseToAnthropic({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 12 } },
    })

    expect(result.usage).toEqual({ input_tokens: 18, output_tokens: 4, cache_read_input_tokens: 12 })
  })

  it('leaves a positive prompt total unchanged when only Anthropic cache fields are present', () => {
    // prompt_tokens 已经是含缓存的总输入。旁边的 cache_read_input_tokens 不是
    // OpenAI 的 cached_tokens，不能再从总输入里扣一次。
    const result = openAiResponseToAnthropic({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 4, cache_read_input_tokens: 12 },
    })

    expect(result.usage).toEqual({ input_tokens: 30, output_tokens: 4 })
  })

  it('ignores usage objects that carry no token counters', () => {
    const result = openAiResponseToAnthropic({ choices: [{ message: { content: 'x' } }], usage: {} })
    expect(result).toEqual({
      id: '',
      type: 'message',
      role: 'assistant',
      model: '',
      content: [{ type: 'text', text: 'x' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
    })
  })

  it('keeps text before tool_use blocks', () => {
    const result = openAiResponseToAnthropic({
      choices: [{
        message: {
          content: 'thinking out loud',
          tool_calls: [
            { id: 'call_1', function: { name: 'a', arguments: '{"x":1}' } },
            { id: 'call_2', function: { name: 'b', arguments: '{"y":2}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    })
    expect((result.content as Array<{ type: string }>).map(block => block.type)).toEqual(['text', 'tool_use', 'tool_use'])
  })

  it('drops custom tool calls instead of emitting a nameless tool_use block', () => {
    // Anthropic 没有自由文本工具概念：custom 调用既没有可映射的名字，也没有 JSON 参数，
    // 硬造一个 tool_use 块只会得到「没有名字、参数永远填不上」的坏内容。
    const result = openAiResponseToAnthropic({
      choices: [{
        message: { content: null, tool_calls: [{ id: 'call_1', type: 'custom', custom: { name: 'raw', input: 'free' } }] },
        finish_reason: 'tool_calls',
      }],
    })

    expect(result.content).toEqual([])
  })
})

describe('OpenAI to Anthropic stream conversion', () => {
  it('emits text lifecycle events and completes when usage arrives', () => {
    const streamState = createOpenAiToAnthropicState()
    const textEvents = openAiChunkToAnthropicEvents({
      id: 'chat_1',
      model: 'gpt',
      choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
    }, streamState)
    const finishEvents = openAiChunkToAnthropicEvents({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }, streamState)

    expect(textEvents.map(event => event.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
    ])
    expect(textEvents[1]).toEqual({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    expect(finishEvents).toEqual([
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 2, output_tokens: 1 } },
      { type: 'message_stop' },
    ])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })

  it('allocates content block indexes that do not collide with tool indexes', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_2', choices: [{ delta: { content: 'Hi' } }] }, streamState)
    const events = [
      ...openAiChunkToAnthropicEvents({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup' } }] } }] }, streamState),
      ...openAiChunkToAnthropicEvents({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }, streamState),
    ]

    const toolStart = events.find(event => event.type === 'content_block_start')
    expect(toolStart).toEqual({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} } })
    const delta = events.find(event => event.type === 'content_block_delta') as { index: number }
    expect(delta.index).toBe(1)
    expect(events.filter(event => event.type === 'content_block_stop').map(event => (event as { index: number }).index)).toEqual([0, 1])
    expect(events.at(-1)).toEqual({ type: 'message_stop' })
  })

  it('keeps one Anthropic index per OpenAI tool index across chunks', () => {
    const streamState = createOpenAiToAnthropicState()
    const first = openAiChunkToAnthropicEvents({
      choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'a' } },
        { index: 1, id: 'call_2', function: { name: 'b' } },
      ] } }],
    }, streamState)
    const second = openAiChunkToAnthropicEvents({
      choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }],
    }, streamState)

    // 下一个工具说明前一个名字已经收齐，所以 index 0 在本块里开。
    // index 1 要等到参数才开，并且继续用同一个 Anthropic index。
    expect(first.filter(event => event.type === 'content_block_start')).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'a', input: {} } },
    ])
    expect(second).toEqual([
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_2', name: 'b', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
    ])
  })

  it('skips custom tool calls instead of emitting a nameless tool_use block', () => {
    // Anthropic 没有自由文本工具概念：custom 调用既没有可映射的名字，也没有 JSON 参数，
    // 硬开一个 tool_use 块只会得到「没有名字、参数永远填不上」的坏内容。
    const streamState = createOpenAiToAnthropicState()
    const events = [
      ...openAiChunkToAnthropicEvents({
        choices: [{ delta: { tool_calls: [
          { index: 0, id: 'call_1', type: 'custom', custom: { name: 'raw', input: 'free' } },
          { index: 1, id: 'call_2', function: { name: 'lookup' } },
        ] } }],
      }, streamState),
      ...openAiChunkToAnthropicEvents({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, streamState),
    ]

    expect(events.filter(event => event.type === 'content_block_start')).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_2', name: 'lookup', input: {} } },
    ])
    expect(JSON.stringify(events)).not.toContain('raw')
  })

  it('waits for usage before closing and closes on flush otherwise', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_3', choices: [{ delta: { content: 'x' } }] }, streamState)

    expect(openAiChunkToAnthropicEvents({ choices: [{ delta: {}, finish_reason: 'length' }] }, streamState)).toEqual([])

    const tail = finishOpenAiToAnthropic(streamState)
    expect(tail.map(event => event.type)).toEqual(['content_block_stop', 'message_delta', 'message_stop'])
    expect(tail[1]).toEqual({ type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null } })
  })

  it('flushes a started stream exactly once', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_1', choices: [{ delta: { content: 'partial' } }] }, streamState)

    expect(finishOpenAiToAnthropic(streamState).map(event => event.type)).toEqual([
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })

  it('never flushes a stream that produced no content', () => {
    const streamState = createOpenAiToAnthropicState()
    expect(openAiChunkToAnthropicEvents({ choices: [{ delta: { role: 'assistant' } }] }, streamState)).toEqual([])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })

  it('emits an empty but valid message when the upstream returns usage only', () => {
    const streamState = createOpenAiToAnthropicState()
    const events = openAiChunkToAnthropicEvents({
      id: 'chat_4',
      model: 'gpt',
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    }, streamState)

    expect(events.map(event => event.type)).toEqual(['message_start', 'message_delta', 'message_stop'])
  })

  it('opens a tool block immediately when the first delta already has the full name', () => {
    const streamState = createOpenAiToAnthropicState()
    const events = openAiChunkToAnthropicEvents({
      id: 'chat_6',
      model: 'gpt',
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup', arguments: '' } }] } }],
    }, streamState)

    expect(events).toEqual([
      {
        type: 'message_start',
        message: {
          id: 'chat_6',
          type: 'message',
          role: 'assistant',
          model: 'gpt',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} } },
    ])
  })

  it('defers a tool block until a function name split across deltas is complete', () => {
    const streamState = createOpenAiToAnthropicState()
    const prefix = openAiChunkToAnthropicEvents({
      id: 'chat_7',
      model: 'gpt',
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_' } }] } }],
    }, streamState)
    const events = openAiChunkToAnthropicEvents({
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { name: 'weather', arguments: '{}' } }] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, streamState)

    expect(prefix).toEqual([])
    const startAt = events.findIndex(event => event.type === 'content_block_start')
    const deltaAt = events.findIndex(event => event.type === 'content_block_delta')
    expect(events[startAt]).toEqual({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} },
    })
    expect(events[deltaAt]).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    })
    expect(deltaAt).toBeGreaterThan(startAt)
    expect(events.at(-1)).toEqual({ type: 'message_stop' })
  })

  it('uses the concatenated name when the stream finishes before arguments arrive', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({
      id: 'chat_8',
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_' } }] } }],
    }, streamState)
    const events = openAiChunkToAnthropicEvents({
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { name: 'weather' } }] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, streamState)

    expect(events.find(event => event.type === 'content_block_start')).toEqual({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} },
    })
  })

  it('opens a pending tool before later text so the call stays ahead of that text', () => {
    const streamState = createOpenAiToAnthropicState()
    const held = [
      ...openAiChunkToAnthropicEvents({
        id: 'chat_9',
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_' } }] },
        }],
      }, streamState),
      ...openAiChunkToAnthropicEvents({
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { name: 'weather' } }] },
        }],
      }, streamState),
    ]
    const text = openAiChunkToAnthropicEvents({
      choices: [{ delta: { content: 'done' } }],
    }, streamState)
    const tail = openAiChunkToAnthropicEvents({
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }, streamState)

    expect(held).toEqual([])
    expect(text.filter(event => event.type === 'content_block_start')).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ])
    expect(text.at(-1)).toEqual({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'done' } })
    expect(tail.filter(event => event.type === 'content_block_start')).toEqual([])
    expect(tail.find(event => event.type === 'content_block_delta')).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"a":1}' },
    })
    expect(tail.filter(event => event.type === 'content_block_stop').map(event => (event as { index: number }).index)).toEqual([0, 1])
  })

  it('keeps a name fragment that shares a chunk with the text that opens the tool', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({
      choices: [{
        delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_' } }] },
      }],
    }, streamState)
    const events = openAiChunkToAnthropicEvents({
      choices: [{
        delta: {
          content: 'after',
          tool_calls: [{ index: 0, function: { name: 'weather', arguments: '{}' } }],
        },
      }],
    }, streamState)

    expect(events.filter(event => event.type === 'content_block_start')).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ])
    expect(events.filter(event => event.type === 'content_block_delta')).toEqual([
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'after' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
    ])
  })

  it('opens the previous tool when the next call shows its split name is complete', () => {
    const streamState = createOpenAiToAnthropicState()
    const events = openAiChunkToAnthropicEvents({
      choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'get_' } },
        { index: 0, function: { name: 'weather' } },
        { index: 1, id: 'call_2', function: { name: 'other', arguments: '{}' } },
      ] } }],
    }, streamState)

    expect(events.filter(event => event.type === 'content_block_start')).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_2', name: 'other', input: {} } },
    ])
    expect(events.at(-1)).toEqual({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    })
  })

  it('merges cache usage reported only on the final chunk', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_5', choices: [{ delta: { content: 'hi' } }] }, streamState)
    const events = openAiChunkToAnthropicEvents({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 7, cache_write_tokens: 5 } },
    }, streamState)

    const delta = events.find(event => event.type === 'message_delta') as { usage: unknown }
    expect(delta.usage).toEqual({ input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 5 })
  })
})
