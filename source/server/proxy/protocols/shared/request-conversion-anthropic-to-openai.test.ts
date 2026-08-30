import { describe, expect, it } from 'vitest'
import { anthropicToOpenAiRequest } from './request-conversion-anthropic-to-openai'

describe('anthropicToOpenAiRequest', () => {
  it('converts system, text, images, tools, and generation options', () => {
    const result = anthropicToOpenAiRequest({
      system: 'Follow policy',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          ],
        },
      ],
      tools: [{ name: 'lookup', description: 'Look up data', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'lookup' },
      max_tokens: 256,
      temperature: 0.2,
      top_p: 0.9,
      stop_sequences: ['END'],
      stream: true,
    }, 'upstream-model')

    expect(result).toEqual({
      model: 'upstream-model',
      messages: [
        { role: 'system', content: 'Follow policy' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up data', parameters: { type: 'object' } } }],
      tool_choice: { type: 'function', function: { name: 'lookup' } },
      max_tokens: 256,
      temperature: 0.2,
      top_p: 0.9,
      stop: ['END'],
      stream: true,
    })
  })

  it('converts tool use and tool results while filtering invalid messages', () => {
    const result = anthropicToOpenAiRequest({
      messages: [
        null,
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Paris' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: 'Sunny' }] }] },
      ],
      tools: [{ description: 'missing name' }],
      tool_choice: { type: 'any' },
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Paris"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'Sunny' },
      ],
      tool_choice: 'required',
    })
  })
})
