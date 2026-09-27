import { describe, expect, it } from 'vitest'
import type { BodyDeliveryShape, Frame } from '@server/proxy/contracts'
import { BufferedProxyResponse } from '@server/proxy/response/proxy-response'
import { createHttpResponseSink, isEventStreamResponse, serializeChunkSnapshot } from './http-response-sink'

const JSON_HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'application/json' } }
const SSE_HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'text/event-stream', 'x-upstream': 'provider-1' } }

function data(text: string): Frame {
  return { kind: 'data', body: Buffer.from(text) }
}

const END: Frame = { kind: 'end' }

function setup(mode: BodyDeliveryShape, captureEnabled = true) {
  const response = new BufferedProxyResponse()
  const sink = createHttpResponseSink({ response, mode, captureEnabled })
  return { response, sink }
}

describe('upstream SSE detection', () => {
  // 这是**事实**检测（上游怎么回的），只用来选解析器。交付行为不看它：那个由
  // `BodyDeliveryShape` 决定，上游没兜住就是执行器那一步的 failover（§1.2）。
  it('detects SSE from the content type regardless of parameter case', () => {
    expect(isEventStreamResponse({ 'content-type': 'text/event-stream; charset=utf-8' })).toBe(true)
    expect(isEventStreamResponse({ 'content-type': 'application/json' })).toBe(false)
    expect(isEventStreamResponse({})).toBe(false)
  })
})

describe('http response sink', () => {
  it('buffers the whole body and writes it once the stream ends', () => {
    const { response, sink } = setup('whole')
    sink.write(JSON_HEAD)
    sink.write(data('{"ok":'))
    // 整包交付下正文在头帧之后就到齐了，但一个字节都不能提前写出，否则头就落后于正文了。
    expect(response.headersSent).toBe(false)
    sink.write(data('true}'))
    sink.write(END)
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"ok":true}')
    expect(response.writableEnded).toBe(true)
    expect(sink.closed).toBe(true)
    // 快照必须与客户端看到的一模一样：状态码、响应头、正文、完整与否都从同一个时刻取。
    expect(sink.delivery()).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      complete: true,
    })
  })

  it('starts the response on the head frame and forwards every chunk when streaming', () => {
    const { response, sink } = setup('incremental')
    sink.write(SSE_HEAD)
    expect(response.headersSent).toBe(true)
    sink.write(data('data: one\n\n'))
    // 增量交付必须边收边发，首字节不能等整段结束。
    expect(response.body).toBe('data: one\n\n')
    sink.write(data('data: two\n\n'))
    sink.write(END)
    expect(response.writableEnded).toBe(true)
    expect(sink.delivery()).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream', 'x-upstream': 'provider-1' },
      body: serializeChunkSnapshot(['data: one\n\n', 'data: two\n\n']),
      complete: true,
    })
  })

  it('does not write to the response after it has already ended', () => {
    const { response, sink } = setup('incremental')
    sink.write(SSE_HEAD)
    sink.write(data('first'))
    response.end()
    sink.write(data('second'))
    sink.write(END)
    expect(response.body).toBe('first')
    expect(sink.delivery()?.body).toBe(serializeChunkSnapshot(['first']))
  })

  it('downstreams nothing at all once the attempt is discarded', () => {
    const delivered: string[] = []
    const response = new BufferedProxyResponse()
    const sink = createHttpResponseSink({
      response,
      mode: 'whole',
      captureEnabled: true,
      onDeliveredChunk: chunk => delivered.push(Buffer.from(chunk).toString('utf8')),
    })
    sink.write(JSON_HEAD)
    sink.discard()
    sink.write(data('{"ok":true}'))
    sink.write(END)
    expect(response.writableEnded).toBe(false)
    // 放弃的尝试从未写出响应头，因此根本不存在「客户端收到过什么」。
    expect(sink.delivery()).toBeNull()
    expect(sink.failure()).toBeNull()
    expect(delivered).toEqual([])
  })

  it('notifies delivered chunks only after the response actually accepts them', () => {
    const delivered: string[] = []
    const response = new BufferedProxyResponse()
    const sink = createHttpResponseSink({
      response,
      mode: 'whole',
      captureEnabled: true,
      onDeliveredChunk: chunk => delivered.push(Buffer.from(chunk).toString('utf8')),
    })

    sink.write(JSON_HEAD)
    sink.write(data('{"ok":true}'))
    expect(delivered).toEqual([])
    sink.write(END)
    expect(delivered).toEqual(['{"ok":true}'])
  })

  it('keeps the whole body but reports no snapshot when capture is disabled', () => {
    const entire = setup('whole', false)
    entire.sink.write(JSON_HEAD)
    entire.sink.write(data('{"ok":true}'))
    entire.sink.write(END)
    expect(entire.sink.delivery()).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      complete: true,
    })

    const incremental = setup('incremental', false)
    incremental.sink.write(SSE_HEAD)
    incremental.sink.write(data('data: one\n\n'))
    incremental.sink.write(END)
    expect(incremental.response.body).toBe('data: one\n\n')
    // 关掉采集时「没有记录」与「记录了一个零块快照」是两件事，不能混。
    expect(incremental.sink.delivery()?.body).toBeNull()
  })

  it('reports the failure frame without touching the response', () => {
    const { response, sink } = setup('whole')
    const failure = new Error('upstream went away')
    sink.write(SSE_HEAD)
    sink.write({ kind: 'error', error: failure })
    expect(sink.failure()).toBe(failure)
    expect(sink.closed).toBe(true)
    // 传输中途失败不在这里收尾：销毁还是 failover 由执行器决定。
    expect(response.writableEnded).toBe(false)
  })

  it('reports delivery as incomplete for whatever was written before an interruption', () => {
    const { sink } = setup('incremental')
    // 还没写下任何字节时，连「响应头发出去了」都还不成立。
    expect(sink.delivery()).toBeNull()
    sink.write(SSE_HEAD)
    sink.write(data('data: one\n\n'))
    expect(sink.delivery()).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream', 'x-upstream': 'provider-1' },
      body: serializeChunkSnapshot(['data: one\n\n']),
      // 没走到收尾：这份正文是半截的。
      complete: false,
    })
  })

  it('waits for the client to drain before the streaming write is considered done', async () => {
    // 出口的 `write` 只有在客户端收得下时才同步完成：收不下就必须挂住，内核据此停止拉下一帧，
    // 上游随之被暂停。少了这一步，慢客户端会被换算成无界的进程内存。
    const response = new BackpressuredResponse()
    const delivered: string[] = []
    const sink = createHttpResponseSink({
      response,
      mode: 'incremental',
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
    const sink = createHttpResponseSink({ response, mode: 'whole', captureEnabled: true })
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
