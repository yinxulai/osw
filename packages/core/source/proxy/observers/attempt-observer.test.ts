import { describe, expect, it } from 'vitest'
import type { AttemptOutcomeView, AttemptView, ExchangeView, TransportKind } from '@server/proxy/contracts'
import { serializeChunkSnapshot } from '@server/proxy/adapters/http-response-sink'
import { createAttemptObserver, UNCAPTURED_RAW_BODY_LIMIT_BYTES } from './attempt-observer'

const JSON_HEADERS = { 'content-type': 'application/json' }
const SSE_HEADERS = { 'content-type': 'text/event-stream' }

function createExchange(transport: TransportKind): ExchangeView {
  return {
    requestId: 'req-1',
    logicalModelId: 'logical-1',
    clientProtocol: 'openai-completions',
    method: 'POST',
    path: '/v1/chat/completions',
    headers: {},
    body: Buffer.alloc(0),
    transport,
    signal: new AbortController().signal,
  }
}

const ATTEMPT: AttemptView = { index: 0, endpointId: 'model-1:openai-completions', endpointProtocol: 'openai-completions' }
const OUTCOME: AttemptOutcomeView = { status: 200, durationMilliseconds: 5 }

function setup(transport: TransportKind, captureEnabled = true, startedAt = Date.now()) {
  const exchange = createExchange(transport)
  const observer = createAttemptObserver({ exchange, attempt: ATTEMPT, captureEnabled, startedAt })
  const send = (text: string) => observer.onUpstreamChunk?.(exchange, ATTEMPT, Buffer.from(text))
  const head = (headers: Record<string, string>, status = 200) => observer.onUpstreamHead?.(exchange, ATTEMPT, status, headers)
  const end = () => observer.onAttemptEnd?.(exchange, ATTEMPT, OUTCOME)
  return { observer, send, head, end }
}

describe('attempt observer', () => {
  it('keeps the upstream head it was told about', () => {
    const { observer, head } = setup('http')
    expect(observer.head()).toBeNull()
    head(JSON_HEADERS, 201)
    expect(observer.head()).toEqual({ kind: 'head', status: 201, headers: JSON_HEADERS })
  })

  it('treats the upstream body as the raw payload under an entire-payload transport', () => {
    const { observer, head, send, end } = setup('http')
    head(JSON_HEADERS)
    send('{"usage"')
    send(':{"prompt_tokens":3}}')
    end()
    expect(observer.upstreamBody()).toBe('{"usage":{"prompt_tokens":3}}')
    expect(observer.rawBody()).toBe('{"usage":{"prompt_tokens":3}}')
    expect(observer.usage()).toMatchObject({ inputTokens: 3 })
  })

  it('reports no TTFT under an entire-payload transport even when the payload contains output', () => {
    const { observer, head, send, end } = setup('http')
    head(JSON_HEADERS)
    send('{"choices":[{"message":{"content":"hello"}}]}')
    end()
    // 客户端拿到的是整段正文，不存在「首字节」这回事。
    expect(observer.ttftMilliseconds()).toBeNull()
  })

  it('snapshots streaming bodies chunk by chunk while keeping the raw text', () => {
    const { observer, head, send, end } = setup('http-stream')
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
    send('data: [DONE]\n')
    end()
    expect(observer.upstreamBody()).toBe(serializeChunkSnapshot(['data: {"choices":[{"delta":{"content":"a"}}]}\n\n', 'data: [DONE]\n']))
    expect(observer.rawBody()).toBe('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n')
  })

  it('only counts real generated output as the first byte', () => {
    const { observer, head, send } = setup('http-stream')
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
    expect(observer.ttftMilliseconds()).toBeNull()
    send('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')
    expect(observer.ttftMilliseconds()).not.toBeNull()
    expect(observer.ttftMilliseconds()).toBeGreaterThanOrEqual(0)
  })

  it('counts a trailing SSE event as the first byte when the stream ends', () => {
    const { observer, head, send, end } = setup('http-stream')
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"content":"hello"}}]}')
    end()
    expect(observer.ttftMilliseconds()).not.toBeNull()
  })

  it('does not go incremental when the client did not ask for it, even for an SSE upstream', () => {
    const { observer, head, send, end } = setup('http')
    head(SSE_HEADERS)
    send('data: {"usage":{"prompt_tokens":4}}\n\n')
    end()
    // 客户端要的是整包，拿到的就是原始字节，因此不可能有分块快照；也不存在首字节时延。
    expect(observer.upstreamBody()).toBe('data: {"usage":{"prompt_tokens":4}}\n\n')
    expect(observer.rawBody()).toBe('data: {"usage":{"prompt_tokens":4}}\n\n')
    expect(observer.ttftMilliseconds()).toBeNull()
  })

  it('records the body by the declared transport rather than by the upstream content type', () => {
    // 观察者不做「上游到底兑现了没有」这个判断：那是执行器的事（不兑现就 failover，
    // 这份记录根本不会成为成功尝试）。它只负责按预期把字节记对，两边各读一半。
    const { observer, head, send, end } = setup('http-stream')
    head(JSON_HEADERS)
    send('{"choices":[]}')
    end()
    expect(observer.upstreamBody()).toBe(serializeChunkSnapshot(['{"choices":[]}']))
    expect(observer.rawBody()).toBe('{"choices":[]}')
  })

  it('drops the chunk snapshots but keeps the raw text when capture is disabled', () => {
    const { observer, head, send, end } = setup('http-stream', false)
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
    end()
    // 健康度判定读原文，因此关掉采集也不能丢它。
    expect(observer.rawBody()).toBe('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
    expect(observer.upstreamBody()).toBe(serializeChunkSnapshot([]))
  })

  it('bounds the diagnostic raw body when capture is disabled', () => {
    const { observer, head, send } = setup('http-stream', false)
    head(SSE_HEADERS)
    send(`data: ${'a'.repeat(UNCAPTURED_RAW_BODY_LIMIT_BYTES)}\n\n`)
    send('data: tail\n\n')

    const raw = observer.rawBody() ?? ''
    expect(Buffer.byteLength(raw)).toBe(UNCAPTURED_RAW_BODY_LIMIT_BYTES)
    expect(raw.endsWith('data: tail\n\n')).toBe(true)
  })
})
