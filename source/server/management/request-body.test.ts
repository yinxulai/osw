import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { parseJsonBody } from './request-body'

type RequestEvent = { type: 'data' | 'end' | 'error' | 'aborted'; value?: unknown }

function request(events: RequestEvent[]): import('node:http').IncomingMessage {
  const emitter = new EventEmitter()
  queueMicrotask(() => {
    for (const item of events) emitter.emit(item.type, item.value)
  })
  return emitter as unknown as import('node:http').IncomingMessage
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
})
