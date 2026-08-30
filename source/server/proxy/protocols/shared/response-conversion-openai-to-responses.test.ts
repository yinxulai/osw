import { describe, expect, it } from 'vitest'
import {
  openAiChunkToResponsesEvents,
  openAiResponseToResponses,
} from './response-conversion-openai-to-responses'

describe('openAiResponseToResponses', () => {
  it('converts text and cache usage to a completed response', () => {
    const result = openAiResponseToResponses({
      id: 'chat_1',
      model: 'gpt',
      choices: [{ message: { content: 'Hello' } }],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 2,
        prompt_tokens_details: { cached_tokens: 3 },
      },
    })

    expect(result).toEqual({
      id: 'chat_1',
      object: 'response',
      status: 'completed',
      model: 'gpt',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] }],
      usage: { input_tokens: 8, output_tokens: 2, input_tokens_details: { cached_tokens: 3 } },
    })
  })

  it('returns an empty output for missing choices', () => {
    expect(openAiResponseToResponses({})).toEqual({
      id: '',
      object: 'response',
      status: 'completed',
      model: '',
      output: [],
    })
  })
})

describe('openAiChunkToResponsesEvents', () => {
  it('emits text deltas followed by completion usage', () => {
    expect(openAiChunkToResponsesEvents({
      choices: [{ delta: { content: 'part' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    })).toEqual([
      { type: 'response.output_text.delta', delta: 'part' },
      { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 1 } } },
    ])
  })

  it('ignores chunks without text or usage', () => {
    expect(openAiChunkToResponsesEvents({ choices: [{ delta: { role: 'assistant' } }] })).toEqual([])
  })
})
