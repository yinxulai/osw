import { describe, expect, it } from 'vitest'
import {
  finishOpenAiToAnthropic,
  openAiChunkToAnthropicEvents,
  openAiResponseToAnthropic,
  type OpenAiToAnthropicState,
} from './response-conversion-openai-to-anthropic'

function state(): OpenAiToAnthropicState {
  return {
    started: false,
    textBlock: false,
    toolBlocks: new Set(),
    stopped: false,
    id: '',
    model: '',
  }
}

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
      usage: { input_tokens: 6, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 },
    })
  })

  it('maps a content filter finish to refusal without tool calls', () => {
    const result = openAiResponseToAnthropic({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })
    expect(result.stop_reason).toBe('refusal')
  })
})

describe('OpenAI to Anthropic stream conversion', () => {
  it('emits text lifecycle events and completes when usage arrives', () => {
    const streamState = state()
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
    expect(finishEvents).toEqual([
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 2, output_tokens: 1 } },
      { type: 'message_stop' },
    ])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })

  it('flushes a started stream exactly once', () => {
    const streamState = state()
    openAiChunkToAnthropicEvents({ id: 'chat_1', choices: [{ delta: { content: 'partial' } }] }, streamState)

    expect(finishOpenAiToAnthropic(streamState).map(event => event.type)).toEqual([
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })
})
