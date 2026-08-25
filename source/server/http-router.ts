import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'

type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

interface HttpRoute<THandler> {
  method: HttpMethod
  path: string
  handler: THandler
}

interface HttpTestResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  json<T = unknown>(): T
}

type HttpTestRequest = IncomingMessage & {
  once: IncomingMessage['once']
}

export class HttpRouter<THandler> {
  [path: string]: any
  private readonly routes: HttpRoute<THandler>[] = []

  constructor() {
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (typeof property === 'string' && property.startsWith('/')) return target.match('POST', property)?.handler
        return Reflect.get(target, property, receiver)
      },
    })
  }

  get(path: string, handler: THandler): this {
    return this.add('GET', path, handler)
  }

  post(path: string, handler: THandler): this {
    return this.add('POST', path, handler)
  }

  put(path: string, handler: THandler): this {
    return this.add('PUT', path, handler)
  }

  patch(path: string, handler: THandler): this {
    return this.add('PATCH', path, handler)
  }

  delete(path: string, handler: THandler): this {
    return this.add('DELETE', path, handler)
  }

  mount(routes: Record<string, THandler> | HttpRouter<THandler>, method: HttpMethod = 'POST'): this {
    if (routes instanceof HttpRouter) {
      for (const route of routes.routes) this.routes.push({ ...route })
      return this
    }
    for (const [path, handler] of Object.entries(routes)) this.add(method, path, handler)
    return this
  }

  match(method: string | undefined, pathname: string): HttpRoute<THandler> | undefined {
    return findHttpRoute(this.routes, method, pathname)
  }

  async invoke(path: string, response: ServerResponse, body: unknown = {}, request: IncomingMessage = createTestRequest(path)): Promise<void> {
    const route = this.match(request.method ?? 'POST', path)
    if (!route) throw new Error(`测试路由不存在: ${request.method ?? 'POST'} ${path}`)
    await (route.handler as (...args: unknown[]) => unknown)(request, response, body)
  }

  async request(path: string, body: unknown = {}): Promise<HttpTestResponse> {
    const request = createTestRequest(path)

    const response = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(name: string, value: string | number | readonly string[]): void {
        this.headers[name.toLowerCase()] = String(value)
      },
      end(value?: string | Uint8Array): void {
        this.body = value ? Buffer.from(value).toString('utf8') : ''
      },
      json<T = unknown>(): T {
        return JSON.parse(this.body) as T
      },
    } as HttpTestResponse & ServerResponse

    await this.invoke(path, response, body, request)
    return response
  }

  private add(method: HttpMethod, path: string, handler: THandler): this {
    this.routes.push({ method, path: normalizePathname(path), handler })
    return this
  }
}

function createTestRequest(path: string): HttpTestRequest {
  const request = new EventEmitter() as EventEmitter & HttpTestRequest
  request.method = 'POST'
  request.url = path
  request.headers = { host: 'localhost', 'content-type': 'application/json' }
  return request
}

function normalizePathname(pathname: string): string {
  const path = pathname.split('?', 1)[0]
  if (path.length <= 1) return path || '/'
  return `/${path.replace(/^\/+|\/+$/g, '')}`
}

function findHttpRoute<THandler>(routes: readonly HttpRoute<THandler>[], method: string | undefined, pathname: string): HttpRoute<THandler> | undefined {
  const normalizedMethod = method?.toUpperCase()
  const normalizedPath = normalizePathname(pathname)
  return routes.find(route => route.method === normalizedMethod && route.path === normalizedPath)
}
