import { describe, expect, it, vi } from 'vitest'
import type { ProtocolAdapter } from '@server/proxy/protocols/shared/types'
import { ResponsePipeline, type ResponsePipelineOptions, type ResponseSink } from '@server/proxy/response/response-pipeline'

function makeAdapter(overrides: Partial<ProtocolAdapter> = {}): ProtocolAdapter {
  const adapter: ProtocolAdapter = {
    kind: 'native',
    clientProtocol: 'openai-completions', endpointProtocol: 'openai-completions', requiresResponseConversion: false,
    prepareRequest: () => Buffer.from(''), createStreamConverter: () => null, finishStream: () => '', convertResponse: body => body,
  }
  return { ...adapter, ...overrides } as ProtocolAdapter
}
function setup(overrides: Partial<ResponsePipelineOptions> = {}) {
  let writableEnded = false
  const response: ResponseSink & { chunks: string[] } = { get writableEnded() { return writableEnded }, chunks: [], write(chunk) { this.chunks.push(chunk) }, end() { writableEnded = true } }
  const onUsage = vi.fn()
  const pipeline = new ResponsePipeline({ adapter: makeAdapter(), isStreaming: false, captureEnabled: true, response, upstreamHeaders: {}, onUsage, onUpstreamChunk: vi.fn(), onDownstreamChunk: vi.fn(), ...overrides })
  return { pipeline, response, onUsage }
}

describe('ResponsePipeline', () => {
  it('forwards successful JSON and extracts usage from nested provider fields', () => {
    const { pipeline, response, onUsage } = setup()
    const body = '{"response":{"usage":{"input_tokens":12,"output_tokens":7}}}'
    pipeline.push(body, true)
    const result = pipeline.finish(true, null)
    expect(response.chunks).toEqual([body])
    expect(result.upstreamBody).toBe(body)
    expect(result.downstreamBody).toBe(body)
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 7 })
    expect(onUsage).toHaveBeenCalledOnce()
  })

  it('extracts reasoning tokens from provider usage details', () => {
    const { pipeline } = setup()
    pipeline.push('{"usage":{"prompt_tokens":12,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":3}}}', true)
    expect(pipeline.finish(true, null).usage.reasoningTokens).toBe(3)
  })

  it.each([
    ['Gemini camel-case metadata', { usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, cachedContentTokenCount: 12 } }, { inputTokens: 30, outputTokens: 4, cachedInputTokens: 12 }],
    ['Gemini total cached tokens', { usage: { input_tokens: 30, output_tokens: 4, total_cached_tokens: 12 } }, { inputTokens: 30, outputTokens: 4, cachedInputTokens: 12 }],
    ['OpenAI prompt cache write details', { usage: { prompt_tokens: 30, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 6 } } }, { cachedInputTokens: 12, cacheCreationInputTokens: 6 }],
    ['OpenAI input cache write details', { usage: { input_tokens: 30, output_tokens: 4, input_tokens_details: { cached_tokens: 12, cache_write_tokens: 6 } } }, { inputTokens: 30, cachedInputTokens: 12, cacheCreationInputTokens: 6 }],
    ['Anthropic cache creation TTL details', { usage: { input_tokens: 12, output_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 7 } } }, { inputTokens: 24, cacheCreationInputTokens: 12 }],
    ['Anthropic cache read and write totals', { usage: { input_tokens: 8, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 5 } }, { inputTokens: 20, cachedInputTokens: 7, cacheCreationInputTokens: 5 }],
  ])('extracts %s', (_name, body, expected) => {
    const { pipeline } = setup()
    pipeline.push(JSON.stringify(body), true)
    expect(pipeline.finish(true, null).usage).toMatchObject(expected)
  })

  it('preserves zero cache metrics', () => {
    const { pipeline } = setup()
    pipeline.push('{"usage":{"prompt_tokens":3,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0}}}', true)
    expect(pipeline.finish(true, null).usage).toMatchObject({ cachedInputTokens: 0, cacheCreationInputTokens: 0 })
  })

  it('parses split SSE lines, ignores DONE, and serializes captured chunks', () => {
    const { pipeline, response } = setup({ isStreaming: true })
    pipeline.push('data: {"usage":{"prompt_tokens":3}}\n\n', true)
    pipeline.push('data: [DONE]\n', true)
    const result = pipeline.finish(true, null)
    expect(result.usage.inputTokens).toBe(3)
    expect(result.upstreamBody).toBe(JSON.stringify({ schemaVersion: 1, chunks: ['data: {"usage":{"prompt_tokens":3}}\n\n', 'data: [DONE]\n'] }))
    expect(response.writableEnded).toBe(true)
  })

  it('reports TTFT only for the first meaningful OpenAI output delta', () => {
    const onFirstOutput = vi.fn()
    const { pipeline } = setup({ isStreaming: true, onFirstOutput })
    pipeline.push('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', true)
    expect(onFirstOutput).not.toHaveBeenCalled()
    pipeline.push('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n', true)
    expect(onFirstOutput).toHaveBeenCalledOnce()
  })

  it('recognizes text output for Anthropic and Responses streams only', () => {
    const anthropicOutput = vi.fn()
    const anthropic = setup({ isStreaming: true, onFirstOutput: anthropicOutput, adapter: makeAdapter({ clientProtocol: 'anthropic-messages', endpointProtocol: 'anthropic-messages' }) })
    anthropic.pipeline.push('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n', true)
    expect(anthropicOutput).not.toHaveBeenCalled()
    anthropic.pipeline.push('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n', true)
    expect(anthropicOutput).toHaveBeenCalledOnce()

    const responsesOutput = vi.fn()
    const responses = setup({ isStreaming: true, onFirstOutput: responsesOutput, adapter: makeAdapter({ clientProtocol: 'openai-responses', endpointProtocol: 'openai-responses' }) })
    responses.pipeline.push('data: {"type":"response.created"}\n\n', true)
    expect(responsesOutput).not.toHaveBeenCalled()
    responses.pipeline.push('data: {"type":"response.output_text.delta","delta":"hello"}\n\n', true)
    expect(responsesOutput).toHaveBeenCalledOnce()
  })

  it('does not report TTFT for non-streaming JSON', () => {
    const onFirstOutput = vi.fn()
    const { pipeline } = setup({ onFirstOutput })
    pipeline.push('{"choices":[{"message":{"content":"hello"}}]}', true)
    pipeline.finish(true, null)
    expect(onFirstOutput).not.toHaveBeenCalled()
  })

  it('falls back to the original body when response conversion fails', () => {
    const { pipeline, response } = setup({
      adapter: makeAdapter({
        kind: 'conversion',
        requiresResponseConversion: true,
        endpointProtocol: 'anthropic-messages',
        createStreamConverter: () => ({ push: () => '', flush: () => '' }),
        convertResponse: () => { throw new Error('bad response') },
      }),
    })
    pipeline.push('{"ok":true}', true)
    pipeline.finish(true, null)
    expect(response.chunks).toEqual(['{"ok":true}'])
  })

  it('does not write after the downstream response has ended', () => {
    const { pipeline, response } = setup({ isStreaming: true })
    pipeline.push('first', true)
    response.end()
    pipeline.push('second', true)
    pipeline.finish(false, 'error')
    expect(response.chunks).toEqual(['first'])
  })
})
