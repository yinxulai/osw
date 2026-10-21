import { describe, expect, it } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { AttemptView, ExchangeView, Frame, UpstreamTarget } from '@server/proxy/contracts'
import { IDLE_TIMEOUT_MESSAGE, createHttpTransport } from './http'

function createExchange(body: string, headers: Record<string, string> = {}): ExchangeView {
  return {
    requestId: 'req-1',
    logicalModelId: 'logical-1',
    clientProtocol: 'openai-completions',
    transport: 'http',
    method: 'POST',
    path: '/v1/chat/completions',
    headers,
    body: Buffer.from(body),
    signal: new AbortController().signal,
  }
}

function createTarget(url: string): UpstreamTarget {
  return {
    providerId: 'provider-1',
    providerName: 'Provider',
    providerModelId: 'model-1',
    providerModelName: 'provider-model',
    apiKeyReference: 'api-key-provider-1',
    customAuthHeader: null,
    endpointId: 'chat-completions',
    protocol: 'openai-completions',
    url,
    timeoutMilliseconds: 5000,
  }
}

const ATTEMPT: AttemptView = { index: 0, endpointId: 'chat-completions', endpointProtocol: 'openai-completions' }

async function withServer(handler: http.RequestListener, run: (url: URL) => Promise<void>): Promise<void> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not start')
  try {
    await run(new URL(`http://127.0.0.1:${address.port}/v1/chat/completions`))
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

async function collect(frames: AsyncIterable<Frame>, limit = 64): Promise<Frame[]> {
  const collected: Frame[] = []
  for await (const frame of frames) {
    collected.push(frame)
    if (collected.length >= limit) break
  }
  return collected
}

function transportWith(idleTimeoutMilliseconds: number) {
  return createHttpTransport({ resolveIdleTimeoutMilliseconds: () => idleTimeoutMilliseconds })
}

describe('http transport', () => {
  it('sends the exchange body and streams the response as frames', async () => {
    await withServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        response.statusCode = 201
        response.setHeader('content-type', 'application/json')
        response.setHeader('x-trace', 'trace-1')
        response.end(JSON.stringify({
          method: request.method,
          body: Buffer.concat(chunks).toString('utf8'),
          contentLength: request.headers['content-length'],
        }))
      })
    }, async url => {
      const connection = await transportWith(0).connect(createTarget(url.toString()), createExchange('payload'), ATTEMPT)
      const frames = await collect(connection.frames)

      expect(frames[0]).toMatchObject({ kind: 'head', status: 201 })
      const head = frames[0] as Frame & { kind: 'head' }
      expect(head.headers['x-trace']).toBe('trace-1')
      expect(frames[frames.length - 1].kind).toBe('end')
      const body = frames.filter(frame => frame.kind === 'data').map(frame => (frame as Frame & { kind: 'data' }).body.toString('utf8')).join('')
      expect(JSON.parse(body)).toEqual({ method: 'POST', body: 'payload', contentLength: '7' })
    })
  })

  it('overrides a stale content-length header with the real byte count', async () => {
    await withServer((request, response) => {
      response.end(String(request.headers['content-length']))
    }, async url => {
      const connection = await transportWith(0).connect(createTarget(url.toString()), createExchange('12345', { 'content-length': '1' }), ATTEMPT)
      const frames = await collect(connection.frames)
      const body = frames.filter(frame => frame.kind === 'data').map(frame => (frame as Frame & { kind: 'data' }).body.toString('utf8')).join('')
      expect(body).toBe('5')
    })
  })

  it('rejects when the upstream connection cannot be established', async () => {
    const closed = http.createServer((_request, response) => response.end('never'))
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))
    const address = closed.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    await new Promise<void>(resolve => closed.close(() => resolve()))

    await expect(transportWith(0).connect(createTarget(`http://127.0.0.1:${address.port}/v1/chat/completions`), createExchange('payload'), ATTEMPT))
      .rejects.toThrow()
  })

  it('emits an error frame when the upstream goes silent', async () => {
    await withServer((_request, response) => {
      const timer = setTimeout(() => response.end('late'), 200)
      response.on('close', () => clearTimeout(timer))
      response.write('first')
    }, async url => {
      const connection = await transportWith(20).connect(createTarget(url.toString()), createExchange('payload'), ATTEMPT)
      const frames = await collect(connection.frames)
      const failure = frames[frames.length - 1] as Frame & { kind: 'error' }
      expect(failure.kind).toBe('error')
      expect(failure.error.message).toBe(IDLE_TIMEOUT_MESSAGE)
    })
  })

  // 消费者每拿到一帧数据就停 150ms，长于 40ms 的空闲设定；上游每 10ms 仍在写。
  // 停下来的这段时间上游是被队列暂停的，不是上游没数据。空闲超时不该把这条流掐掉。
  it('does not idle-timeout an upstream paused for a slow consumer', async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const timer = setInterval(() => {
        if (!response.writableEnded && !response.destroyed) response.write('data: tick\n\n')
      }, 10)
      response.on('close', () => clearInterval(timer))
    }, async url => {
      const connection = await transportWith(40).connect(createTarget(url.toString()), createExchange('payload'), ATTEMPT)
      const iterator = connection.frames[Symbol.asyncIterator]()
      const seen: Frame[] = []
      try {
        let dataFrames = 0
        while (dataFrames < 3) {
          const next = await iterator.next()
          if (next.done) break
          seen.push(next.value)
          if (next.value.kind === 'error' || next.value.kind === 'end') break
          if (next.value.kind === 'data') {
            dataFrames += 1
            await new Promise(resolve => setTimeout(resolve, 150))
          }
        }
        const failure = seen.find((frame): frame is Frame & { kind: 'error' } => frame.kind === 'error')
        expect(failure?.error.message).toBeUndefined()
        expect(dataFrames).toBe(3)
      } finally {
        connection.abort()
        await iterator.return?.()
      }
    })
  })

  it('ends with an error frame when the upstream drops the connection mid-body', async () => {
    // 上游声明了 `content-length` 却只发一半就掐连接：此时 `end` 与 `error` 都不会来。
    // 不按 `close` 收尾，帧序列就永远等不到终止帧，消费者会一直挂到客户端自己放弃。
    // 用裸 TCP 服务端手写这半条响应，才能精确摆出「头 + 半截正文 + 撤连接」这个时序。
    const server = net.createServer(socket => {
      socket.on('error', () => {})
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: 1000\r\n\r\ndata: one\n\n')
        setTimeout(() => socket.destroy(), 20)
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')

    try {
      const connection = await transportWith(0).connect(createTarget(`http://127.0.0.1:${address.port}/v1/chat/completions`), createExchange('payload'), ATTEMPT)
      const frames = await collect(connection.frames)
      expect(frames[frames.length - 1]).toMatchObject({ kind: 'error' })
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('ends the frame sequence when the connection is aborted', async () => {
    await withServer((_request, response) => {
      const timer = setInterval(() => response.write('tick'), 20)
      response.on('close', () => clearInterval(timer))
      response.write('first')
    }, async url => {
      const connection = await transportWith(0).connect(createTarget(url.toString()), createExchange('payload'), ATTEMPT)
      const iterator = connection.frames[Symbol.asyncIterator]()
      expect((await iterator.next()).value).toMatchObject({ kind: 'head' })

      connection.abort()

      const collected: Frame[] = []
      for (;;) {
        const next = await iterator.next()
        if (next.done) break
        collected.push(next.value)
        if (collected.length > 8) throw new Error('aborted connection kept producing frames')
      }
      expect(collected.length).toBeLessThanOrEqual(8)
    })
  })

  it('rejects the connection when the exchange signal is already aborted', async () => {
    await withServer((_request, response) => response.end('never'), async url => {
      const controller = new AbortController()
      controller.abort()
      const exchange = { ...createExchange('payload'), signal: controller.signal }
      await expect(transportWith(0).connect(createTarget(url.toString()), exchange, ATTEMPT)).rejects.toThrow('CLIENT_REQUEST_ABORTED')
    })
  })
})
