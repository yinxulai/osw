import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { TelemetryBatch } from '@common/telemetry'
import { createTelemetrySender } from './sender'

/**
 * 发送端要断言的是「报文长什么样」，所以这里起一个真的本地 HTTP 服务来收：
 * 替身拿到的是调用参数，而「头有没有写对、body 是不是这批事件」只有真连接才看得出来。
 */

interface ReceivedRequest {
  method: string | undefined
  url: string | undefined
  headers: http.IncomingHttpHeaders
  body: string
}

interface StubEndpoint {
  url: string
  received: ReceivedRequest[]
  close: () => Promise<void>
}

const SAMPLE_BATCH: TelemetryBatch = {
  events: [
    {
      occurredAt: 1_700_000_000_000,
      installId: '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d',
      version: '1.1.0-beta.14',
      os: 'win32',
      arch: 'x64',
      locale: 'zh-CN',
      runtime: 'desktop',
      name: 'app_started',
    },
  ],
}

async function startEndpoint(statusCode: number): Promise<StubEndpoint> {
  const received: ReceivedRequest[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += String(chunk)
    })
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body })
      res.statusCode = statusCode
      res.end('{}')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('stub endpoint did not start')
  return {
    url: `http://127.0.0.1:${address.port}/v1/track?tenant=test`,
    received,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

let endpoint: StubEndpoint | null = null

afterEach(async () => {
  await endpoint?.close()
  endpoint = null
})

describe('createTelemetrySender', () => {
  it('posts the batch as json to the given endpoint', async () => {
    endpoint = await startEndpoint(200)

    await createTelemetrySender()(endpoint.url, SAMPLE_BATCH)

    expect(endpoint.received).toHaveLength(1)
    const request = endpoint.received[0]
    expect(request?.method).toBe('POST')
    // 查询串要原样带上：正式端点靠路径与查询串区分环境。
    expect(request?.url).toBe('/v1/track?tenant=test')
    expect(request?.headers['content-type']).toBe('application/json')
    expect(request?.headers['user-agent']).toBe('OSW-Telemetry')
    expect(JSON.parse(request?.body ?? '')).toEqual(SAMPLE_BATCH)
  })

  it('accepts any 2xx as success', async () => {
    endpoint = await startEndpoint(204)

    await expect(createTelemetrySender()(endpoint.url, SAMPLE_BATCH)).resolves.toBeUndefined()
  })

  it('throws on a non-2xx response so the caller can drop the batch', async () => {
    endpoint = await startEndpoint(500)

    await expect(createTelemetrySender()(endpoint.url, SAMPLE_BATCH)).rejects.toThrow('telemetry endpoint responded with 500')
  })

  it('throws instead of guessing when the endpoint is not a url', async () => {
    await expect(createTelemetrySender()('not-a-url', SAMPLE_BATCH)).rejects.toThrow()
  })

  it('does not leak the host user agent', async () => {
    // 报文里本来就没有用户代理的痕迹，请求头也不该把它写回去。
    endpoint = await startEndpoint(200)

    await createTelemetrySender()(endpoint.url, SAMPLE_BATCH)

    expect(endpoint.received[0]?.headers['user-agent']).not.toContain('Electron')
  })
})
