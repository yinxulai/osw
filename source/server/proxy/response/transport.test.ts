import { describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { attachDownstreamAbort, attachResponseIdleTimeout, requestBufferedUpstream, sendUpstreamRequest } from '@server/proxy/response/transport'

describe('transport', () => {
  it('sends a request body and exposes the response', async () => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ method: req.method, body }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = new URL(`http://127.0.0.1:${address.port}/test`)

    try {
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const request = sendUpstreamRequest(url, {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'content-length': '7' },
        }, Buffer.from('payload'), resolve)
        request.on('error', reject)
      })
      const chunks: Buffer[] = []
      for await (const chunk of response) chunks.push(Buffer.from(chunk))
      expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({ method: 'POST', body: 'payload' })
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('routes request lifecycle events through transport hooks', async () => {
    const server = http.createServer((_req, res) => {
      res.end('ok')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = new URL(`http://127.0.0.1:${address.port}/test`)
    const events: string[] = []

    try {
      await new Promise<void>((resolve, reject) => {
        sendUpstreamRequest(url, {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'GET',
        }, Buffer.alloc(0), {
          onResponse: response => {
            events.push(`response:${response.statusCode}`)
            response.resume()
            response.once('end', resolve)
          },
          onError: reject,
          onTimeout: request => request.destroy(new Error('test timeout')),
        })
      })
      expect(events).toEqual(['response:200'])
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('destroys a response after an idle period and resets on data', async () => {
    const server = http.createServer((_req, res) => {
      res.write('first')
      setTimeout(() => res.end('second'), 40)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = new URL(`http://127.0.0.1:${address.port}/test`)

    try {
      await new Promise<void>((resolve, reject) => {
        sendUpstreamRequest(url, {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'GET',
        }, Buffer.alloc(0), {
          onResponse: response => {
            response.once('error', error => {
              expect(error.message).toBe('Idle timeout')
              resolve()
            })
            attachResponseIdleTimeout(response, 20)
            response.resume()
          },
          onError: error => {
            if (error.message !== 'Idle timeout') reject(error)
          },
          onTimeout: request => request.destroy(new Error('test timeout')),
        })
      })
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('destroys the upstream request when the downstream request aborts', () => {
    const downstreamRequest = new http.IncomingMessage(null as never)
    const downstreamResponse = new http.ServerResponse(downstreamRequest)
    const destroy = vi.fn()
    const upstreamRequest = { destroy } as unknown as http.ClientRequest
    let aborted = 0

    const binding = attachDownstreamAbort(downstreamRequest, downstreamResponse, upstreamRequest, () => {
      aborted++
    })
    downstreamRequest.emit('aborted')

    expect(aborted).toBe(1)
    expect(destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'CLIENT_REQUEST_ABORTED' }))

    binding.dispose()
    downstreamRequest.emit('aborted')
    expect(aborted).toBe(1)
  })

  it('buffers upstream response payload into a structured result', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 201
      res.setHeader('x-trace-id', 'trace-test')
      res.write('hello')
      res.end(' world')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = new URL(`http://127.0.0.1:${address.port}/buffered`)

    try {
      const result = await requestBufferedUpstream(url, {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
      }, Buffer.from('payload'))

      expect(result.statusCode).toBe(201)
      expect(result.headers['x-trace-id']).toBe('trace-test')
      expect(result.body).toBe('hello world')
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('uses default timeout handler when hooks are passed as a function', async () => {
    const server = http.createServer(() => {
      // Intentionally keep the connection open to trigger client timeout.
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not start')
    const url = new URL(`http://127.0.0.1:${address.port}/timeout`)

    try {
      await new Promise<void>(resolve => {
        const request = sendUpstreamRequest(url, {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'GET',
          timeout: 20,
        }, Buffer.alloc(0), () => undefined)
        request.on('error', error => {
          expect(error.message).toBe('Connection timeout')
          resolve()
        })
      })
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('aborts upstream request on downstream close when response is not finished', () => {
    const downstreamRequest = new http.IncomingMessage(null as never)
    const downstreamResponse = new http.ServerResponse(downstreamRequest)
    const destroy = vi.fn()
    const upstreamRequest = { destroy } as unknown as http.ClientRequest
    const onAbort = vi.fn()

    attachDownstreamAbort(downstreamRequest, downstreamResponse, upstreamRequest, onAbort)
    downstreamResponse.emit('close')

    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'CLIENT_REQUEST_ABORTED' }))
  })

  it('does not abort upstream on downstream close after response is finished', () => {
    const downstreamRequest = new http.IncomingMessage(null as never)
    const downstreamResponse = new http.ServerResponse(downstreamRequest)
    Object.defineProperty(downstreamResponse, 'writableEnded', { value: true, configurable: true })
    const destroy = vi.fn()
    const upstreamRequest = { destroy } as unknown as http.ClientRequest
    const onAbort = vi.fn()

    attachDownstreamAbort(downstreamRequest, downstreamResponse, upstreamRequest, onAbort)
    downstreamResponse.emit('close')

    expect(onAbort).not.toHaveBeenCalled()
    expect(destroy).not.toHaveBeenCalled()
  })
})
