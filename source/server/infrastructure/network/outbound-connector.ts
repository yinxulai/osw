import type http from 'node:http'
import { ProxyAgent } from 'proxy-agent'
import type { OutboundProxyMode, Settings } from '@common/schemas'
import { AppError } from '../../errors'
import { normalizeProxyUrl, resolveChromiumProxyRule, shouldBypassProxy } from './outbound-proxy'

export type SystemProxyResolver = (targetUrl: string) => Promise<string>
export type OutboundProxySettings = Pick<Settings, 'outboundProxyMode' | 'outboundProxyUrl' | 'outboundProxyBypass'>

export class OutboundProxyConnectionError extends Error {
  readonly name = 'OutboundProxyConnectionError'

  constructor(cause: Error) {
    super(cause.message, { cause })
  }
}

export function isOutboundProxyConnectionError(error: unknown): error is OutboundProxyConnectionError {
  return error instanceof OutboundProxyConnectionError
}

export interface OutboundConnector {
  initialize(): Promise<void>
  requestOptions(url: URL): Pick<http.RequestOptions, 'agent'>
  isProxyRequest(request: http.ClientRequest): boolean
  destroy(): void
}

export function createOutboundConnector(getSettings: () => OutboundProxySettings | Promise<OutboundProxySettings>, systemProxyResolver: SystemProxyResolver = async () => 'DIRECT'): OutboundConnector {
  const requestRoutes = new WeakMap<http.ClientRequest, boolean>()
  const resolveForRequest = async (targetUrl: string): Promise<string> => {
    const settings = await getSettings()
    const bypassed = shouldBypassProxy(targetUrl, settings.outboundProxyBypass)
    if (bypassed) return ''
    return resolveProxyUrl(settings.outboundProxyMode, settings.outboundProxyUrl, targetUrl, systemProxyResolver)
  }
  const proxy = new ProxyAgent({
    keepAlive: true,
    getProxyForUrl: async (targetUrl: string, request: http.ClientRequest) => {
      const proxyUrl = await resolveForRequest(targetUrl)
      requestRoutes.set(request, Boolean(proxyUrl))
      return proxyUrl
    },
  })
  return {
    initialize: async () => {
      await resolveForRequest('https://example.com/')
    },
    requestOptions: () => ({ agent: proxy }),
    isProxyRequest: request => requestRoutes.get(request) ?? false,
    destroy: () => proxy.destroy(),
  }
}

async function resolveProxyUrl(mode: OutboundProxyMode, customUrl: string, targetUrl: string, systemProxyResolver: SystemProxyResolver): Promise<string> {
  if (mode === 'direct') return ''
  if (mode === 'custom') return normalizeProxyUrl(customUrl)
  try {
    const rule = await systemProxyResolver(targetUrl)
    return resolveChromiumProxyRule(rule, targetUrl)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('SYSTEM_PROXY_RESOLUTION_FAILED', 502, '无法解析系统代理设置', { cause: error })
  }
}

let sharedConnector: OutboundConnector | null = null
let configuredSystemProxyResolver: SystemProxyResolver = async () => 'DIRECT'

export function configureOutboundConnector(connector: OutboundConnector, systemProxyResolver?: SystemProxyResolver): void {
  sharedConnector?.destroy()
  sharedConnector = connector
  configuredSystemProxyResolver = systemProxyResolver ?? (async () => 'DIRECT')
}

export function getSystemProxyResolver(): SystemProxyResolver {
  return configuredSystemProxyResolver
}

export function destroyOutboundConnector(): void {
  sharedConnector?.destroy()
  sharedConnector = null
  configuredSystemProxyResolver = async () => 'DIRECT'
}
