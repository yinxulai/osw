import { describe, expect, it } from 'vitest'
import { openAiToAnthropicRequest } from './request-conversion-openai-to-anthropic'

describe('openAiToAnthropicRequest', () => {
  it('converts system messages, multimodal content, tools, and options', () => {
    const result = openAiToAnthropicRequest({
      messages: [
        { role: 'system', content: 'System one' },
        { role: 'developer', content: 'System two' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xyz' } },
            { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          ],
        },
      ],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' } } }],
      tool_choice: 'required',
      max_tokens: 300,
      temperature: 0.3,
      top_p: 0.8,
      stop: ['DONE'],
      stream: true,
    }, 'upstream-model')

    expect(result).toEqual({
      model: 'upstream-model',
      system: 'System one\n\nSystem two',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'xyz' } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/image.png' } },
        ],
      }],
      max_tokens: 300,
      temperature: 0.3,
      top_p: 0.8,
      stop_sequences: ['DONE'],
      stream: true,
      tools: [{ name: 'lookup', description: 'Lookup', input_schema: { type: 'object' } }],
      tool_choice: { type: 'any' },
    })
  })

  it('converts tool calls and results and tolerates malformed arguments', () => {
    const result = openAiToAnthropicRequest({
      messages: [
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{bad' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'result' },
      ],
      tool_choice: 'none',
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      max_tokens: 4096,
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'lookup', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'result' }] },
      ],
      tool_choice: { type: 'none' },
    })
  })
})
