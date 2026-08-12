import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAvailableBindings, detectProtocolFromPath } from './router'
import { markProviderSuccess, markProviderFailure } from '../health'
import { getSettings } from '../db/store'
import { generateId } from '@common/utils'
import type { BindingWithProvider } from './router'
import { resolveUpstreamUrl, rewriteRequestModel } from './request'
import { classifyUpstreamStatus } from './response'
import { createAuthHeaders } from './auth'
import { getSecretStore } from '../secrets'
import { createDownstreamHeaders, createUpstreamHeaders } from './headers'

type AttemptResult = 'success' | 'retry' | 'terminal'

// 手动切换状态：当前指定的 binding ID
let manualBindingId: string | null = null

export function setManualBinding(bindingId: string | null): void {
  manualBindingId = bindingId
}

export function getManualBinding(): string | null {
  return manualBindingId
}

/**
 * 处理代理请求
 * 支持自动故障切换和手动切换
 */
export async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logicalModelId: string,
): Promise<void> {
  const requestId = generateId('req_')
  let attemptIndex = 0
  let lastError: Error | null = null

  const protocol = detectProtocolFromPath(req.url!)
  if (!protocol) {
    writeJsonError(res, 404, 'UNKNOWN_API_PATH', '无法识别的 API 路径')
    return
  }

  // 获取可用 bindings（按协议过滤）
  let bindings = getAvailableBindings(logicalModelId).filter(b => b.binding.protocol === protocol)

  // 如果有手动指定的 binding，把它排到最前面
  if (manualBindingId) {
    const manual = bindings.find(b => b.binding.id === manualBindingId)
    if (manual) {
      bindings = [manual, ...bindings.filter(b => b.binding.id !== manualBindingId)]
    }
  }

  if (bindings.length === 0) {
    writeJsonError(res, 503, 'NO_AVAILABLE_PROVIDER', '没有可用的上游 Provider')
    return
  }

  // 收集请求体（用于重试时重发）
  const requestBody = await readRequestBody(req)

  for (const target of bindings) {
    try {
      const result = await attemptRequest(req, res, target, requestBody, requestId, attemptIndex)
      if (result === 'success') {
        markProviderSuccess(target.provider.id)
        return
      }
      if (result === 'terminal') return

      markProviderFailure(target.provider.id)
      attemptIndex++
    } catch (err) {
      lastError = err as Error
      markProviderFailure(target.provider.id)
      if (res.headersSent) {
        res.destroy(lastError)
        return
      }
      attemptIndex++
    }
  }

  // 所有 binding 都失败了
  if (!res.headersSent) {
    writeJsonError(
      res,
      502,
      'ALL_PROVIDERS_FAILED',
      lastError?.message ?? '所有上游 Provider 都失败了',
    )
  }
}

async function attemptRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: BindingWithProvider,
  requestBody: Buffer,
  _requestId: string,
  _attemptIndex: number,
): Promise<AttemptResult> {
  const { binding, provider } = target
  const settings = getSettings()

  const targetUrl = resolveUpstreamUrl(
    req.url!,
    binding.upstreamUrl,
    binding.protocol,
    binding.upstreamModelId,
  )
  const parsed = new URL(targetUrl)
  const upstreamBody = rewriteRequestModel(requestBody, binding.upstreamModelId, binding.protocol)
  const apiKey = await getSecretStore().get(provider.apiKeyReference)
  if (!apiKey) throw new Error(`API key is unavailable for provider ${provider.id}`)

  const isHttps = parsed.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers = createUpstreamHeaders(
    req.headers,
    createAuthHeaders(binding.protocol, apiKey, binding.customAuthHeader),
    upstreamBody.length,
  )

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers,
    timeout: provider.timeoutMilliseconds,
  }

  return new Promise((resolve, reject) => {
    const upstreamReq = transport.request(options, upstreamRes => {
      const statusCode = upstreamRes.statusCode ?? 502
      const disposition = classifyUpstreamStatus(statusCode)

      // 空闲超时检测
      let idleTimer: NodeJS.Timeout | null = null
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          upstreamRes.destroy(new Error('Idle timeout'))
        }, settings.idleTimeoutMilliseconds)
      }

      resetIdleTimer()

      if (disposition === 'retry') {
        upstreamRes.on('data', resetIdleTimer)
        upstreamRes.on('end', () => {
          if (idleTimer) clearTimeout(idleTimer)
          resolve('retry')
        })
        upstreamRes.on('error', err => {
          if (idleTimer) clearTimeout(idleTimer)
          reject(err)
        })
        upstreamRes.resume()
        return
      }

      // 转发响应头
      if (!res.headersSent) {
        res.writeHead(statusCode, createDownstreamHeaders(upstreamRes.headers))
      }

      upstreamRes.on('data', chunk => {
        resetIdleTimer()
        if (!res.writableEnded) {
          res.write(chunk)
        }
      })

      upstreamRes.on('end', () => {
        if (idleTimer) clearTimeout(idleTimer)
        if (!res.writableEnded) {
          res.end()
        }
        resolve(disposition)
      })

      upstreamRes.on('error', err => {
        if (idleTimer) clearTimeout(idleTimer)
        reject(err)
      })
    })

    upstreamReq.on('error', err => {
      reject(err)
    })

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(new Error('Connection timeout'))
    })

    // 发送请求体
    if (upstreamBody.length > 0) {
      upstreamReq.write(upstreamBody)
    }
    upstreamReq.end()
  })
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function writeJsonError(res: ServerResponse, statusCode: number, errorCode: string, errorMessage: string): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      success: false,
      errorCode,
      errorMessage,
    }),
  )
}
