import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { CLIENT_REQUEST_ABORTED } from '@common/error-codes'
import { OutboundProxyModeSchema } from '@common/schemas'
import { AppError } from '../../../errors'
import { createCoreNetworkClient } from '../../../infrastructure/network/core-network'
import { createOutboundConnector, getSystemProxyResolver } from '../../../infrastructure/network/outbound-connector'
import { normalizeProxyUrl } from '../../../infrastructure/network/outbound-proxy'
import { HttpRouter } from '../../../http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

const OutboundProxyTestSchema = z.object({
  mode: OutboundProxyModeSchema,
  proxyUrl: z.string(),
  bypass: z.string(),
  targetUrl: z.string().url(),
}).superRefine((input, context) => {
  if (input.mode !== 'custom') return
  try {
    normalizeProxyUrl(input.proxyUrl)
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message, path: ['proxyUrl'] })
  }
})

export interface OutboundProxyTestResult {
  targetUrl: string
  statusCode: number
  durationMilliseconds: number
}

export const outboundProxyTestRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/outbound-proxy/test', handleOutboundProxyTest)

async function handleOutboundProxyTest(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const input = OutboundProxyTestSchema.parse(body)
  const target = new URL(input.targetUrl)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new AppError('VALIDATION_ERROR', 400, 'The test target must use HTTP or HTTPS')
  }

  const connector = createOutboundConnector(() => ({
    outboundProxyMode: input.mode,
    outboundProxyUrl: input.proxyUrl,
    outboundProxyBypass: input.bypass,
  }), getSystemProxyResolver())
  await connector.initialize()
  const networkClient = createCoreNetworkClient(connector)
  const startedAt = Date.now()
  let activeRequest: ReturnType<typeof networkClient.requestHttp> | null = null
  const onClientAbort = () => activeRequest?.destroy(new AppError(CLIENT_REQUEST_ABORTED, 499, 'The client cancelled the request'))
  req.once('aborted', onClientAbort)

  try {
    const result = await new Promise<OutboundProxyTestResult>((resolve, reject) => {
      activeRequest = networkClient.requestHttp(target, {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'GET',
        headers: { Accept: '*/*', 'User-Agent': 'OSW-Proxy-Test' },
        timeout: 15000,
      }, Buffer.alloc(0), {
        onResponse: response => {
          response.resume()
          resolve({
            targetUrl: target.toString(),
            statusCode: response.statusCode ?? 0,
            durationMilliseconds: Date.now() - startedAt,
          })
        },
        onError: error => reject(classifyConnectionError(error)),
        onTimeout: request => request.destroy(new AppError('UPSTREAM_TIMEOUT', 504, 'The outbound proxy connection test timed out')),
      })
    })
    sendSuccess(res, result)
  } finally {
    req.removeListener('aborted', onClientAbort)
    connector.destroy()
  }
}

function classifyConnectionError(error: Error): AppError {
  if (error instanceof AppError) return error
  const message = error.message.toLowerCase()
  if (message.includes('407') || message.includes('proxy authentication')) {
    return new AppError('OUTBOUND_PROXY_AUTH_REQUIRED', 502, 'The outbound proxy requires authentication, check the credentials', { cause: error })
  }
  if (message.includes('tunnel') || message.includes('connect response')) {
    return new AppError('OUTBOUND_PROXY_TUNNEL_REJECTED', 502, 'The outbound proxy rejected the tunnel', { cause: error })
  }
  return new AppError('OUTBOUND_PROXY_UNREACHABLE', 502, 'Could not reach the target through the current settings', { cause: error })
}
