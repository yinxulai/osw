import { describe, expect, it } from 'vitest'
import { responsesToOpenAiRequest } from './request-conversion-responses-to-openai'

describe('responsesToOpenAiRequest', () => {
  it('converts instructions, text, images, and request options', () => {
    const result = responsesToOpenAiRequest({
      instructions: 'Be concise',
      input: [
        'plain input',
        { role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'input_image', image_url: { url: 'https://example.com/a.png' } }] },
      ],
      max_output_tokens: 512,
      temperature: 0.4,
      top_p: 0.7,
      stream: true,
      prompt_cache_key: 'cache-key',
      prompt_cache_retention: '24h',
    }, 'upstream-model')

    expect(result).toEqual({
      model: 'upstream-model',
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'plain input' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] },
      ],
      max_tokens: 512,
      temperature: 0.4,
      top_p: 0.7,
      stream: true,
      prompt_cache_key: 'cache-key',
      prompt_cache_retention: '24h',
    })
  })

  it('converts function calls and outputs and skips invalid input', () => {
    const result = responsesToOpenAiRequest({
      input: [
        null,
        { role: 'assistant', content: [{ type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' }] },
        { role: 'user', content: [{ type: 'function_call_output', call_id: 'call_1', output: 'found' }] },
      ],
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'found' },
      ],
    })
  })
})
