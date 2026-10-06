import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { parseJsonBody } from './core/request-body'

type RequestEvent = { type: 'data' | 'end' | 'error' | 'aborted'; value?: unknown }

interface FakeRequest extends EventEmitter {
  headers: Record<string, string>
}

function request(events: RequestEvent[], headers: Record<string, string> = {}): IncomingMessage {
  const emitter = new EventEmitter() as FakeRequest
  // 真实的 `IncomingMessage` 一定有 `headers`：断言里用它表达「客户端声明的长度」。
  emitter.headers = headers
  queueMicrotask(() => {
    for (const item of events) emitter.emit(item.type, item.value)
  })
  return emitter as unknown as IncomingMessage
}

describe('parseJsonBody', () => {
  it('parses chunked JSON and returns an empty object for an empty body', async () => {
    await expect(parseJsonBody(request([
      { type: 'data', value: Buffer.from('{"name":') },
      { type: 'data', value: Buffer.from('"demo"}') },
      { type: 'end' },
    ]))).resolves.toEqual({ name: 'demo' })
    await expect(parseJsonBody(request([{ type: 'end' }]))).resolves.toEqual({})
  })

  it('normalizes malformed JSON to INVALID_JSON', async () => {
    await expect(parseJsonBody(request([{ type: 'data', value: Buffer.from('{') }, { type: 'end' }]))).rejects.toMatchObject({ code: 'INVALID_JSON', statusCode: 400 })
  })

  it('rejects aborted and errored requests only once', async () => {
    await expect(parseJsonBody(request([{ type: 'aborted' }]))).rejects.toThrow('CLIENT_REQUEST_ABORTED')
    await expect(parseJsonBody(request([{ type: 'error', value: new Error('socket failure') }, { type: 'end' }]))).rejects.toThrow('socket failure')
  })

  it('ignores chunks that arrive after the request already settled', async () => {
    // 中断之后还可能来分片（内核缓冲区里的残句）。这些分片没有接收方，丢掉即可——
    // 真把它们拼上去，一条已经结算的请求会在解析时又抛一次错。
    await expect(parseJsonBody(request([
      { type: 'aborted' },
      { type: 'data', value: Buffer.from('garbage') },
      { type: 'end' },
    ]))).rejects.toThrow('CLIENT_REQUEST_ABORTED')
  })

  it('accepts a body whose declared length is far beyond any former limit', async () => {
    // 上限是有意去掉的，这条用例锁住的就是「不设限」本身：别让它以任何形式长回来。
    await expect(parseJsonBody(request(
      [{ type: 'data', value: Buffer.from('{"ok":true}') }, { type: 'end' }],
      { 'content-length': String(64 * 1024 * 1024) },
    ))).resolves.toEqual({ ok: true })
  })
})
