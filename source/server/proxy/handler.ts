import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAvailableBindings, detectProtocolFromPath } from './router'
import { markProviderSuccess, markProviderFailure } from '../health'
import { getSettings } from '../db/store'
import { generateId } from '@common/utils'
import type { BindingWithProvider } from './router'

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

  // 检测协议类型
  const protocol = detectProtocolFromPath(req.url!) || 'openai'

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
      const success = await attemptRequest(req, res, target, requestBody, requestId, attemptIndex)
      if (success) {
        markProviderSuccess(target.provider.id)
        return
      }
    } catch (err) {
      lastError = err as Error
      markProviderFailure(target.provider.id)
      attemptIndex++
      continue // 尝试下一个
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
): Promise<boolean> {
  const { binding, provider } = target
  const settings = getSettings()

  // 构建目标 URL（用 binding 上的 upstreamUrl）
  const targetUrl = buildTargetUrl(req.url!, binding.upstreamUrl, binding.upstreamModelId)
  const parsed = new URL(targetUrl)

  const isHttps = parsed.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() === 'host') continue
    if (key.toLowerCase() === 'content-length') continue
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value
    }
  }

  // 替换 Authorization
  // TODO: 从 keychain 获取真实 API key
  headers['authorization'] = `Bearer ${provider.apiKeyReference}`

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
      // 空闲超时检测
      let idleTimer: NodeJS.Timeout | null = null
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          upstreamRes.destroy(new Error('Idle timeout'))
        }, settings.idleTimeoutMilliseconds)
      }

      resetIdleTimer()

      // 转发响应头
      if (!res.headersSent) {
        res.writeHead(upstreamRes.statusCode!, upstreamRes.headers)
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
        const statusCode = upstreamRes.statusCode ?? 0
        resolve(statusCode >= 200 && statusCode < 400)
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
    if (requestBody.length > 0) {
      upstreamReq.write(requestBody)
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

function buildTargetUrl(originalUrl: string, baseUrl: string, _upstreamModelId: string): string {
  const url = new URL(originalUrl, 'http://localhost')
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const pathname = url.pathname

  // 简单的路径拼接，不做协议转换
  let targetPath = pathname

  // 对于 OpenAI 风格的请求，替换 model 字段在 body 里的处理在 proxy 层不做
  // 这里只处理路径转发
  return `${base}${targetPath}${url.search}`
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
