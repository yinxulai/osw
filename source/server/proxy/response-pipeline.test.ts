import { describe, expect, it, vi } from 'vitest'
import type { ProtocolAdapter } from './protocols/types'
import { ResponsePipeline, type ResponsePipelineOptions, type ResponseSink } from './response-pipeline'

function makeAdapter(overrides: Partial<ProtocolAdapter> = {}): ProtocolAdapter {
  return {
    clientProtocol: 'openai-completions', endpointProtocol: 'openai-completions', requiresResponseConversion: false,
    prepareRequest: () => Buffer.from(''), createStreamConverter: () => null, finishStream: () => '', convertResponse: body => body,
    ...overrides,
  }
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
    const { pipeline, response } = setup({ adapter: makeAdapter({ requiresResponseConversion: true, convertResponse: () => { throw new Error('bad response') } }) })
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
