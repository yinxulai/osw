import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { attachResponseIdleTimeout, sendUpstreamRequest } from './transport'

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
})
