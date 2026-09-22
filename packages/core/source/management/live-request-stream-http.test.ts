import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { liveRequestStore } from '@server/proxy/observability/live-request-store'
import { requestLogRoutes } from './routes/observability/request-logs'

const STREAM_PATH = '/api/request-log/live/stream'
const decoders = new Map<string, TextDecoder>()

/**
 * 推送通道走一条**真实的** HTTP 连接验一遍。
 *
 * 上面那个用例把 `ServerResponse` 换成假对象，验的是「什么时候写什么」；这里验的是假对象永远
 * 证不了的两件事：真实响应的写入语义（`res.write` 的背压与 `drain`、`close` 事件）与
 * **这条连接不会在推完第一帧就结束**。假对象缺 `on` / `off` 时前一类用例照样会绿——
 * 这正是它值一条真连接的原因。
 */
describe('推送通道走真实的 HTTP 连接', () => {
  let server: Server | null = null
  let baseUrl = ''

  beforeEach(async () => {
    liveRequestStore.clear()
    const stream = requestLogRoutes[STREAM_PATH]
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk as Buffer))
      req.on('end', () => {
        void stream(req, res, {})
      })
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    liveRequestStore.clear()
    const closing = server
    server = null
    if (!closing) return
    await new Promise<void>(resolve => closing.close(() => resolve()))
  })

  async function nextLine(reader: ReadableStreamDefaultReader<Uint8Array>, key: string): Promise<string> {
    const { value } = await reader.read()
    const decoder = decoders.get(key) ?? new TextDecoder()
    decoders.set(key, decoder)
    return decoder.decode(value, { stream: true })
  }

  it('同一条连接上先给一份当前快照，随后持续推新的快照', async () => {
    const response = await fetch(`${baseUrl}${STREAM_PATH}`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    // NDJSON：一份快照一行，客户端按行切就行。
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    // 这份数据只在「此刻」有意义，任何一级缓存都会把它变成过期快照。
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')

    const reader = response.body!.getReader()
    const first = await nextLine(reader, 'first')
    expect(first.endsWith('\n')).toBe(true)
    expect(JSON.parse(first)).toEqual({ requests: [] })

    // 台账变了以后**同一条连接**上还能再收到一帧：连接没有在推完第一帧就结束。
    liveRequestStore.begin({
      id: 'req_http',
      method: 'POST',
      path: '/v1/messages',
      transport: 'http',
      clientProtocol: null,
    })
    const second = await nextLine(reader, 'second')
    expect(JSON.parse(second)).toMatchObject({ requests: [{ id: 'req_http' }] })

    await reader.cancel()
  })

  it('客户端挂断后这个通道还能继续服务下一个客户端', async () => {
    const controller = new AbortController()
    const aborted = await fetch(`${baseUrl}${STREAM_PATH}`, {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    })
    const abortedReader = aborted.body!.getReader()
    await nextLine(abortedReader, 'aborted')

    // 客户端关掉这条长连接（换页、关窗口）之后，服务端那条订阅必须跟着消失。
    controller.abort()
    await expect(abortedReader.read()).rejects.toThrow()

    // 订阅者与节拍器都是模块级状态：上一个客户端走了之后，下一个人仍然能连上、能收帧。
    const response = await fetch(`${baseUrl}${STREAM_PATH}`, { method: 'POST', body: '{}' })
    const reader = response.body!.getReader()
    expect(JSON.parse(await nextLine(reader, 'reconnect'))).toEqual({ requests: [] })

    liveRequestStore.begin({
      id: 'req_after',
      method: 'POST',
      path: '/v1/messages',
      transport: 'http',
      clientProtocol: null,
    })
    expect(JSON.parse(await nextLine(reader, 'reconnect-later')))
      .toMatchObject({ requests: [{ id: 'req_after' }] })

    await reader.cancel()
  })
})
