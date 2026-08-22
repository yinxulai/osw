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

  it('parses split SSE lines, ignores DONE, and serializes captured chunks', () => {
    const { pipeline, response } = setup({ isStreaming: true })
    pipeline.push('data: {"usage":{"prompt_tokens":3}}\n\n', true)
    pipeline.push('data: [DONE]\n', true)
    const result = pipeline.finish(true, null)
    expect(result.usage.inputTokens).toBe(3)
    expect(result.upstreamBody).toBe(JSON.stringify({ schemaVersion: 1, chunks: ['data: {"usage":{"prompt_tokens":3}}\n\n', 'data: [DONE]\n'] }))
    expect(response.writableEnded).toBe(true)
  })

  it('falls back to the original body when response conversion fails', () => {
    const { pipeline, response } = setup({ adapter: makeAdapter({ requiresResponseConversion: true, convertResponse: () => { throw new Error('bad response') } }) })
    pipeline.push('{"ok":true}', true)
    pipeline.finish(true, null)
    expect(response.chunks).toEqual(['{"ok":true}'])
  })

  it('does not write after the downstream response has ended', () => {
    const { pipeline, response } = setup()
    pipeline.push('first', true)
    response.end()
    pipeline.push('second', true)
    pipeline.finish(false, 'error')
    expect(response.chunks).toEqual(['first'])
  })
})
