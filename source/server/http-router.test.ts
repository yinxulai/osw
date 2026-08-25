import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { HttpRouter } from './http-router'

describe('HttpRouter path matching', () => {
  it.each([
    ['/api/provider/list?verbose=true', '/api/provider/list'],
    ['/api/provider/list/', '/api/provider/list'],
    ['///', '/'],
    ['', '/'],
  ])('normalizes %s to %s', (pathname, expected) => {
    const router = new HttpRouter<string>().post(expected, 'matched')
    expect(router.match('POST', pathname)?.handler).toBe('matched')
  })
})

describe('HttpRouter method matching', () => {
  const router = new HttpRouter<string>()
    .get('/health', 'get-health')
    .post('/health', 'post-health')

  it('matches both method and normalized path', () => {
    expect(router.match('POST', '/health/?check=1')?.handler).toBe('post-health')
    expect(router.match('get', '/health')?.handler).toBe('get-health')
  })

  it('does not match an unsupported method or path', () => {
    expect(router.match('DELETE', '/health')).toBeUndefined()
    expect(router.match('GET', '/missing')).toBeUndefined()
  })

  it('executes a registered handler through the test request helper', async () => {
    const router = new HttpRouter<(
      _request: never,
      response: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void },
      body: unknown,
    ) => void>()
      .post('/echo', (_request, response, body) => {
        response.statusCode = 201
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ body }))
      })

    const response = await router.request('/echo?trace=1', { value: 'test' })

    expect(response.statusCode).toBe(201)
    expect(response.headers['content-type']).toBe('application/json')
    expect(response.json()).toEqual({ body: { value: 'test' } })
  })

  it('invokes a handler with a custom request and response', async () => {
    const router = new HttpRouter<(request: { method?: string }, response: { end(body: string): void }, body: unknown) => void>()
      .post('/echo', (request, response, body) => {
        response.end(JSON.stringify({ method: request.method, body }))
      })
    const response = { end: vi.fn() } as unknown as ServerResponse
    const request = { method: 'POST' } as unknown as IncomingMessage

    await router.invoke('/echo', response, { value: 'custom' }, request)

    expect(response.end).toHaveBeenCalledWith(JSON.stringify({ method: 'POST', body: { value: 'custom' } }))
  })

  it('rejects invocation of a missing route', async () => {
    const router = new HttpRouter<() => void>()

    await expect(router.invoke('/missing', {} as ServerResponse)).rejects.toThrow('测试路由不存在: POST /missing')
  })
})
