import { describe, expect, it } from 'vitest'
import type { Frame, TransportKind } from '@server/proxy/contracts'
import { BufferedProxyResponse } from '@server/proxy/response/proxy-response'
import { createHttpResponseSink, isEventStreamResponse, serializeChunkSnapshot } from './http-response-sink'

const JSON_HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'application/json' } }
const SSE_HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } }

function data(text: string): Frame {
  return { kind: 'data', body: Buffer.from(text) }
}

const END: Frame = { kind: 'end' }

function setup(transport: TransportKind, captureEnabled = true) {
  const response = new BufferedProxyResponse()
  const sink = createHttpResponseSink({ response, transport, captureEnabled })
  return { response, sink }
}

describe('upstream SSE detection', () => {
  // 这是**事实**检测（上游怎么回的），只用来选解析器。传输行为不看它：那个由
  // 客户端声明的 transport 决定，上游没兜住就是执行器那一步的 failover（§1.2）。
  it('detects SSE from the content type regardless of parameter case', () => {
    expect(isEventStreamResponse({ 'content-type': 'text/event-stream; charset=utf-8' })).toBe(true)
    expect(isEventStreamResponse({ 'content-type': 'application/json' })).toBe(false)
    expect(isEventStreamResponse({})).toBe(false)
  })
})

describe('http response sink', () => {
  it('buffers the whole body and writes it once the stream ends', () => {
    const { response, sink } = setup('http')
    sink.write(JSON_HEAD)
    sink.write(data('{"ok":'))
    // 整包传输下正文在头帧之后就到齐了，但一个字节都不能提前写出，否则头就落后于正文了。
    expect(response.headersSent).toBe(false)
    sink.write(data('true}'))
    sink.write(END)
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"ok":true}')
    expect(response.writableEnded).toBe(true)
    expect(sink.downstreamBody()).toBe('{"ok":true}')
    expect(sink.closed).toBe(true)
  })

  it('starts the response on the head frame and forwards every chunk when streaming', () => {
    const { response, sink } = setup('http-stream')
    sink.write(SSE_HEAD)
    expect(response.headersSent).toBe(true)
    sink.write(data('data: one\n\n'))
    // 增量传输必须边收边发，首字节不能等整段结束。
    expect(response.body).toBe('data: one\n\n')
    sink.write(data('data: two\n\n'))
    sink.write(END)
    expect(response.writableEnded).toBe(true)
    expect(sink.downstreamBody()).toBe(serializeChunkSnapshot(['data: one\n\n', 'data: two\n\n']))
  })

  it('does not write to the response after it has already ended', () => {
    const { response, sink } = setup('http-stream')
    sink.write(SSE_HEAD)
    sink.write(data('first'))
    response.end()
    sink.write(data('second'))
    sink.write(END)
    expect(response.body).toBe('first')
    expect(sink.downstreamBody()).toBe(serializeChunkSnapshot(['first']))
  })

  it('downstreams nothing at all once the attempt is discarded', () => {
    const delivered: string[] = []
    const response = new BufferedProxyResponse()
    const sink = createHttpResponseSink({
      response,
      transport: 'http',
      captureEnabled: true,
      onDeliveredChunk: chunk => delivered.push(Buffer.from(chunk).toString('utf8')),
    })
    sink.write(JSON_HEAD)
    sink.discard()
    sink.write(data('{"ok":true}'))
    sink.write(END)
    expect(response.writableEnded).toBe(false)
    expect(sink.downstreamBody()).toBeNull()
    expect(sink.failure()).toBeNull()
    expect(delivered).toEqual([])
  })

  it('notifies delivered chunks only after the response actually accepts them', () => {
    const delivered: string[] = []
    const response = new BufferedProxyResponse()
    const sink = createHttpResponseSink({
      response,
      transport: 'http',
      captureEnabled: true,
      onDeliveredChunk: chunk => delivered.push(Buffer.from(chunk).toString('utf8')),
    })

    sink.write(JSON_HEAD)
    sink.write(data('{"ok":true}'))
    expect(delivered).toEqual([])
    sink.write(END)
    expect(delivered).toEqual(['{"ok":true}'])
  })

  it('keeps the entire body even when capture is disabled but drops the chunk snapshots', () => {
    const entire = setup('http', false)
    entire.sink.write(JSON_HEAD)
    entire.sink.write(data('{"ok":true}'))
    entire.sink.write(END)
    expect(entire.sink.downstreamBody()).toBe('{"ok":true}')

    const incremental = setup('http-stream', false)
    incremental.sink.write(SSE_HEAD)
    incremental.sink.write(data('data: one\n\n'))
    incremental.sink.write(END)
    expect(incremental.response.body).toBe('data: one\n\n')
    expect(incremental.sink.downstreamBody()).toBe(serializeChunkSnapshot([]))
  })

  it('reports the failure frame without touching the response', () => {
    const { response, sink } = setup('http')
    const failure = new Error('upstream went away')
    sink.write(SSE_HEAD)
    sink.write({ kind: 'error', error: failure })
    expect(sink.failure()).toBe(failure)
    expect(sink.closed).toBe(true)
    // 传输中途失败不在这里收尾：销毁还是 failover 由执行器决定。
    expect(response.writableEnded).toBe(false)
  })

  it('reports the partial downstream body only for what was actually written', () => {
    const { sink } = setup('http-stream')
    expect(sink.partialDownstreamBody()).toBeNull()
    sink.write(SSE_HEAD)
    sink.write(data('data: one\n\n'))
    expect(sink.partialDownstreamBody()).toBe('data: one\n\n')
  })

  it('waits for the client to drain before the streaming write is considered done', async () => {
    // 出口的 `write` 只有在客户端收得下时才同步完成：收不下就必须挂住，内核据此停止拉下一帧，
    // 上游随之被暂停。少了这一步，慢客户端会被换算成无界的进程内存。
    const response = new BackpressuredResponse()
    const delivered: string[] = []
    const sink = createHttpResponseSink({
      response,
      transport: 'http-stream',
      captureEnabled: true,
      onDeliveredChunk: chunk => delivered.push(Buffer.from(chunk).toString('utf8')),
    })
    sink.write(SSE_HEAD)

    let done = false
    const pending = Promise.resolve(sink.write(data('data: one\n\n'))).then(() => { done = true })
    expect(response.written).toEqual(['data: one\n\n'])
    expect(delivered).toEqual([])
    await Promise.resolve()
    expect(done).toBe(false)
    expect(delivered).toEqual([])

    response.drain()
    await pending

    expect(done).toBe(true)
    expect(delivered).toEqual(['data: one\n\n'])
    const second = sink.write(data('data: two\n\n'))
    expect(response.written).toEqual(['data: one\n\n', 'data: two\n\n'])
    response.drain()
    await second
  })

  it('ends the buffered response only after the client drained the whole body', async () => {
    const response = new BackpressuredResponse()
    const sink = createHttpResponseSink({ response, transport: 'http', captureEnabled: true })
    sink.write(JSON_HEAD)
    sink.write(data('{"ok":true}'))

    const pending = sink.write(END)
    // 正文已经写进去了，但收尾必须等客户端收走——否则「写完」只是写进了内核缓冲区。
    expect(response.writableEnded).toBe(false)
    response.drain()
    await pending

    expect(response.writableEnded).toBe(true)
    expect(response.written).toEqual(['{"ok":true}'])
  })
})

/** 每次写入都报告「客户端收不动」的出口，直到测试主动放行。 */
class BackpressuredResponse extends BufferedProxyResponse {
  readonly written: string[] = []
  private release: (() => void) | null = null

  override write(chunk: string | Uint8Array): boolean {
    this.written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return false
  }

  drained(): Promise<void> {
    return new Promise(resolve => { this.release = resolve })
  }

  drain(): void {
    const release = this.release
    this.release = null
    release?.()
  }
}
