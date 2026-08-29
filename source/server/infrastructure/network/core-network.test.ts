import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureCoreNetworkConnector,
  coreNetworkClient,
  createCoreNetworkClient,
  resetCoreNetworkConnector,
} from './core-network'
import {
  OutboundProxyConnectionError,
  type OutboundConnector,
} from './outbound-connector'

describe('core network client', () => {
  afterEach(() => {
    resetCoreNetworkConnector()
  })

  it('sends request and receives response with a dedicated connector client', async () => {
    const connector = createNoProxyConnector()
    const client = createCoreNetworkClient(connector)
    const server = http.createServer((req, res) => {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        res.statusCode = 201
        res.end(body)
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server start failed')
    const url = new URL(`http://127.0.0.1:${address.port}/echo`)

    try {
      const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const request = client.requestHttp(url, {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
        }, Buffer.from('hello'), {
          onResponse: resolve,
          onError: reject,
          onTimeout: req => req.destroy(new Error('timeout')),
        })
        request.on('error', reject)
      })

      const chunks: Buffer[] = []
      for await (const chunk of response) chunks.push(Buffer.from(chunk))
      expect(response.statusCode).toBe(201)
      expect(Buffer.concat(chunks).toString('utf8')).toBe('hello')
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      connector.destroy()
    }
  })

  it('wraps request errors as OutboundProxyConnectionError when request is proxied', async () => {
    const unusedPort = await reserveAndReleasePort()
    const url = new URL(`http://127.0.0.1:${unusedPort}/unreachable`)
    const connector = createNoProxyConnector(true)
    const client = createCoreNetworkClient(connector)

    await expect(new Promise<void>((resolve, reject) => {
      client.requestHttp(url, {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
      }, Buffer.alloc(0), {
        onResponse: response => {
          response.resume()
          resolve()
        },
        onError: reject,
        onTimeout: req => req.destroy(new Error('timeout')),
      })
    })).rejects.toBeInstanceOf(OutboundProxyConnectionError)

    connector.destroy()
  })

  it('fails buffered requests when response body exceeds maxResponseBytes', async () => {
    const connector = createNoProxyConnector()
    const client = createCoreNetworkClient(connector)
    const server = http.createServer((_req, res) => {
      res.write('12345')
      res.end('67890')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server start failed')
    const url = new URL(`http://127.0.0.1:${address.port}/limit`)

    try {
      await expect(client.requestHttpBuffered(url, {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
      }, Buffer.alloc(0), 8)).rejects.toMatchObject({
        code: 'UPSTREAM_UNAVAILABLE',
      })
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      connector.destroy()
    }
  })

  it('uses configured shared connector from module state', async () => {
    const connector = createNoProxyConnector()
    const requestOptionsSpy = vi.spyOn(connector, 'requestOptions')
    configureCoreNetworkConnector(connector)

    const server = http.createServer((_req, res) => res.end('ok'))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server start failed')
    const url = new URL(`http://127.0.0.1:${address.port}/shared`)

    try {
      await new Promise<void>((resolve, reject) => {
        coreNetworkClient.requestHttp(url, {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'GET',
        }, Buffer.alloc(0), {
          onResponse: response => {
            response.resume()
            response.once('end', resolve)
          },
          onError: reject,
          onTimeout: req => req.destroy(new Error('timeout')),
        })
      })

      expect(requestOptionsSpy).toHaveBeenCalledTimes(1)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})

function createNoProxyConnector(isProxyRequest = false): OutboundConnector {
  return {
    initialize: async () => undefined,
    requestOptions: () => ({}),
    isProxyRequest: () => isProxyRequest,
    destroy: () => undefined,
  }
}

async function reserveAndReleasePort(): Promise<number> {
  const server = http.createServer(() => undefined)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server start failed')
  const port = address.port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}
