import { describe, expect, it } from 'vitest'
import {
  anthropicEventToOpenAiChunks,
  anthropicResponseToOpenAi,
  type AnthropicToOpenAiState,
} from './response-conversion-anthropic-to-openai'

function state(): AnthropicToOpenAiState {
  return { id: '', model: '', toolCalls: new Map(), started: false }
}

describe('anthropicResponseToOpenAi', () => {
  it('converts text, tool calls, stop reason, and cache usage', () => {
    const result = anthropicResponseToOpenAi({
      id: 'msg_1',
      model: 'claude',
      content: [
        { type: 'text', text: 'Checking' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: { id: 1 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    })

    expect(result).toMatchObject({
      id: 'msg_1',
      object: 'chat.completion',
      model: 'claude',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Checking',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
      },
    })
  })
})

describe('anthropicEventToOpenAiChunks', () => {
  it('tracks message metadata, tool deltas, and merged usage', () => {
    const streamState = state()
    const start = anthropicEventToOpenAiChunks({
      type: 'message_start',
      message: { id: 'msg_1', model: 'claude', usage: { input_tokens: 5 } },
    }, streamState)
    const toolStart = anthropicEventToOpenAiChunks({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'call_1', name: 'lookup' },
    }, streamState)
    const toolDelta = anthropicEventToOpenAiChunks({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"id":' },
    }, streamState)
    const finish = anthropicEventToOpenAiChunks({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 2 },
    }, streamState)

    expect(start[0]).toMatchObject({ id: 'msg_1', model: 'claude', choices: [{ delta: { role: 'assistant' } }] })
    expect(toolStart[0]).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 2, id: 'call_1', function: { name: 'lookup' } }] } }] })
    expect(toolDelta[0]).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 2, function: { arguments: '{"id":' } }] } }] })
    expect(finish[0]).toMatchObject({
      choices: [{ finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })
    expect(streamState.toolCalls.get(2)).toEqual({ id: 'call_1', name: 'lookup' })
  })
})
