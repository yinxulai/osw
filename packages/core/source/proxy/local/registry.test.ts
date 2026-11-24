import type { ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { localEndpoints, matchLocalEndpoint } from './registry'
import { modelCatalogEndpoint } from './model-catalog-endpoint'
import { modelsEndpoint } from './models-endpoint'

interface CapturedResponse {
  readonly statusCode: number
  readonly headers: Record<string, string>
  readonly body: string
  readonly ended: boolean
}

function callModelsEndpoint(): CapturedResponse {
  const captured = { statusCode: 0, headers: {} as Record<string, string>, body: '', ended: false }
  const response = {
    statusCode: captured.statusCode,
    setHeader(name: string, value: string | number | readonly string[]): void {
      captured.headers[name.toLowerCase()] = String(value)
    },
    end(value?: string | Uint8Array): void {
      captured.body = value ? Buffer.from(value).toString('utf8') : ''
      captured.ended = true
      captured.statusCode = response.statusCode
    },
  } as unknown as ServerResponse & { statusCode: number }

  modelsEndpoint.handle({ request: {} as never, response })
  return captured
}

describe('matchLocalEndpoint', () => {
  it('declares every local endpoint exactly once', () => {
    const keys = localEndpoints.map(endpoint => `${endpoint.method} ${endpoint.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each([
    ['GET', '/v1/models', modelsEndpoint],
    ['get', '/v1/models', modelsEndpoint],
    ['GET', '/v1/models/', modelsEndpoint],
    ['GET', '/v1/models?limit=10', modelsEndpoint],
    ['GET', '/v1/model-catalog', modelCatalogEndpoint],
    ['GET', '/v1/model-catalog?client_version=0.172.0', modelCatalogEndpoint],
  ])('matches %s %s', (method, path, endpoint) => {
    expect(matchLocalEndpoint(method, path)).toBe(endpoint)
  })

  // 方法感知是这一步的直接收益：同样是 `/v1/models`，POST 应当继续走代理转发路径。
  it.each([
    ['POST', '/v1/models'],
    ['DELETE', '/v1/models'],
    ['GET', '/models'],
    ['GET', '/v1/chat/completions'],
    ['GET', '/v1/models/extra'],
    ['POST', '/v1/model-catalog'],
    ['GET', '/v1/model-catalogs'],
    ['GET', '/'],
  ])('does not claim %s %s', (method, path) => {
    expect(matchLocalEndpoint(method, path)).toBeUndefined()
  })
})

describe('modelsEndpoint', () => {
  it('writes a model list without touching the upstream', () => {
    const captured = callModelsEndpoint()
    expect(captured.ended).toBe(true)
    expect(captured.statusCode).toBe(200)
    expect(captured.headers['content-type']).toBe('application/json')
    expect(JSON.parse(captured.body)).toEqual({
      object: 'list',
      data: [{ id: 'default', object: 'model', created: 0, owned_by: 'osw' }],
    })
  })
})
