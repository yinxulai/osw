import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAvailableModels, detectProtocolFromPath, findEndpoint } from './router'
import { markProviderSuccess, markProviderFailure } from './health'
import { getSettings, createRequestLog, createRequestAttempt, updateRequestLogStatus } from '../database/store'
import { generateId } from '@common/utils'
import type { ModelWithProvider } from './router'
import type { Protocol, RequestStatus } from '@common/schemas'
import { resolveUpstreamUrl, resolveEffectiveUpstreamUrl, rewriteRequestModel, injectUsageParams } from './request'
import { classifyUpstreamStatus } from './response'
import { createAuthHeaders } from './auth'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { createDownstreamHeaders, createUpstreamHeaders } from './headers'
import type { UpstreamStatusDisposition } from './response'

interface AttemptOutcome {
  disposition: UpstreamStatusDisposition
  statusCode: number
  durationMilliseconds: number
  errorCode?: string
  errorMessage?: string
  ttftMilliseconds?: number
  inputTokens?: number | null
  outputTokens?: number | null
  cacheHit?: boolean
}

// 手动切换状态：当前指定的 upstream model ID
let manualModelId: string | null = null

export function setManualModel(modelId: string | null): void {
  manualModelId = modelId
}

export function getManualModel(): string | null {
  return manualModelId
}

/**
 * 处理代理请求
 * 支持自动故障切换和手动切换
 */
export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse, logicalModelId: string): Promise<void> {
  const requestId = generateId('req_')
  let attemptIndex = 0
  let lastError: Error | null = null

  const protocol = detectProtocolFromPath(req.url!)
  if (!protocol) {
    console.error(
      `[proxy] 无法识别的 API 路径: ${req.method} ${req.url} (logicalModel=${logicalModelId}, requestId=${requestId})`,
    )
    writeJsonError(res, 404, 'UNKNOWN_API_PATH', '无法识别的 API 路径')
    return
  }

  // 获取可用 models，并过滤出支持当前协议的模型
  let models = (await getAvailableModels(logicalModelId)).filter(m => findEndpoint(m.model, protocol))

  // 如果有手动指定的 model，把它排到最前面
  if (manualModelId) {
    const manual = models.find(m => m.model.id === manualModelId)
    if (manual) {
      models = [manual, ...models.filter(m => m.model.id !== manualModelId)]
    }
  }

  if (models.length === 0) {
    console.warn(
      `[proxy] 没有可用的上游 Provider: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${logicalModelId}, requestId=${requestId})`,
    )
    writeJsonError(res, 503, 'NO_AVAILABLE_PROVIDER', '没有可用的上游 Provider')
    return
  }

  // 收集请求体（用于重试时重发）
  const requestBody = await readRequestBody(req)
  const startedAt = Date.now()

  // 先创建请求日志（占位状态），供各 attempt 作为外键引用，结束时再更新为最终状态
  try {
    await createRequestLog({
      id: requestId,
      logicalModelId,
      protocol,
      status: 'failed',
      totalDurationMilliseconds: 0,
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      ttftMilliseconds: null,
      cacheHit: null,
    })
  } catch (error) {
    console.error(`[proxy] 写入请求日志失败: ${(error as Error).message}`)
  }

  for (const target of models) {
    try {
      const outcome = await attemptRequest(req, res, target, protocol, requestBody, requestId, attemptIndex)

      if (outcome.disposition === 'success') {
        console.log(
          `[proxy] 透传成功: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.upstreamModelId} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await markProviderSuccess(target.provider.id)
        await finalizeRequestLog(requestId, 'success', startedAt, {
          ttftMilliseconds: outcome.ttftMilliseconds ?? null,
          inputTokens: outcome.inputTokens ?? null,
          outputTokens: outcome.outputTokens ?? null,
          cacheHit: outcome.cacheHit ?? null,
        })
        return
      }
      if (outcome.disposition === 'terminal') {
        console.log(
          `[proxy] 请求终止(无重试): ${req.method} ${req.url} -> ${target.provider.id}/${target.model.upstreamModelId} (protocol=${protocol}, requestId=${requestId}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await markProviderFailure(target.provider.id)
        await finalizeRequestLog(requestId, 'failed', startedAt)
        return
      }

      console.warn(
        `[proxy] 上游返回可重试状态: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.upstreamModelId} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode})`,
      )
      await markProviderFailure(target.provider.id)
      attemptIndex++
    } catch (err) {
      lastError = err as Error
      console.error(
        `[proxy] 上游请求失败: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.upstreamModelId} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}) error=${lastError.message}`,
      )
      try {
        await createRequestAttempt({
          requestId,
          providerId: target.provider.id,
          upstreamModelId: target.model.upstreamModelId,
          attemptIndex,
          status: 'failed',
          errorCode: 'UPSTREAM_ERROR',
          errorMessage: lastError.message,
          durationMilliseconds: Date.now() - startedAt,
        })
      } catch (logError) {
        console.error(`[proxy] 写入请求尝试日志失败: ${(logError as Error).message}`)
      }
      await markProviderFailure(target.provider.id)
      if (res.headersSent) {
        res.destroy(lastError)
        await finalizeRequestLog(requestId, 'failed', startedAt)
        return
      }
      attemptIndex++
    }
  }

  // 所有 model 都失败了
  if (!res.headersSent) {
    console.error(
      `[proxy] 所有上游 Provider 均失败: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${logicalModelId}, requestId=${requestId}) error=${lastError?.message}`,
    )
    writeJsonError(
      res,
      502,
      'ALL_PROVIDERS_FAILED',
      lastError?.message ?? '所有上游 Provider 都失败了',
    )
  }
  await finalizeRequestLog(requestId, 'failed', startedAt)
}

interface RequestLogMetrics {
  ttftMilliseconds?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheHit?: boolean | null
}

async function finalizeRequestLog(requestId: string, status: RequestStatus, startedAt: number, metrics?: RequestLogMetrics): Promise<void> {
  try {
    const totalDuration = Date.now() - startedAt
    const hasTokens = metrics?.inputTokens != null && metrics?.outputTokens != null
    const totalTokens = hasTokens ? (metrics!.inputTokens! + metrics!.outputTokens!) : null
    await updateRequestLogStatus(requestId, {
      status,
      totalDurationMilliseconds: totalDuration,
      totalTokens,
      inputTokens: metrics?.inputTokens ?? null,
      outputTokens: metrics?.outputTokens ?? null,
      ttftMilliseconds: metrics?.ttftMilliseconds ?? null,
      cacheHit: metrics?.cacheHit ?? null,
    })
  } catch (error) {
    console.error(`[proxy] 更新请求日志失败: ${(error as Error).message}`)
  }
}

async function attemptRequest(req: IncomingMessage, res: ServerResponse, target: ModelWithProvider, protocol: Protocol, requestBody: Buffer, requestId: string, attemptIndex: number): Promise<AttemptOutcome> {
  const { model, provider } = target
  const settings = await getSettings()

  const endpoint = findEndpoint(model, protocol)
  if (!endpoint) throw new Error(`模型 ${model.upstreamModelId} 不支持协议 ${protocol}`)

  const targetUrl = resolveUpstreamUrl(resolveEffectiveUpstreamUrl(endpoint.upstreamUrl, provider.upstreamUrls, endpoint.protocol))
  const parsed = new URL(targetUrl)
  const rewrittenBody = rewriteRequestModel(requestBody, model.upstreamModelId)
  const upstreamBody = injectUsageParams(rewrittenBody, protocol)
  const apiKey = await getSecretStore().get(provider.apiKeyReference)
  if (!apiKey) throw new Error(`API key is unavailable for provider ${provider.id}`)

  const isHttps = parsed.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers = createUpstreamHeaders(
    req.headers,
    createAuthHeaders(endpoint.protocol, apiKey, endpoint.customAuthHeader),
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

  const attemptStartedAt = Date.now()
  const recordAttempt = async (status: RequestStatus, errorCode?: string, errorMessage?: string) => {
    try {
      await createRequestAttempt({
        requestId,
        providerId: provider.id,
        upstreamModelId: model.upstreamModelId,
        attemptIndex,
        status,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        durationMilliseconds: Date.now() - attemptStartedAt,
      })
    } catch (error) {
      console.error(`[proxy] 写入请求尝试日志失败: ${(error as Error).message}`)
    }
  }

  return new Promise<AttemptOutcome>((resolve, reject) => {
    const upstreamReq = transport.request(options, upstreamRes => {
      const statusCode = upstreamRes.statusCode ?? 502
      const disposition = classifyUpstreamStatus(statusCode)

      // 检测缓存命中
      const cacheHeader = upstreamRes.headers['x-cache'] ?? upstreamRes.headers['cf-cache-status']
      const cacheHit = cacheHeader ? /^HIT/i.test(String(cacheHeader)) : undefined

      // TTFT 与 token 采集
      let ttftMilliseconds: number | undefined
      let inputTokens: number | null = null
      let outputTokens: number | null = null
      let responseBuffer = ''
      let isStreaming = false

      const contentType = String(upstreamRes.headers['content-type'] ?? '')
      isStreaming = contentType.includes('text/event-stream')

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
          void recordAttempt('failed', `Status_${statusCode}`, `上游返回 ${statusCode}`)
          resolve({ disposition: 'retry', statusCode, durationMilliseconds: Date.now() - attemptStartedAt })
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

        // 记录 TTFT（第一个数据块到达时间）
        if (ttftMilliseconds === undefined) {
          ttftMilliseconds = Date.now() - attemptStartedAt
        }

        if (disposition === 'success') {
          responseBuffer += chunk.toString('utf8')

          if (isStreaming) {
            // 流式响应：逐行解析 SSE 中的 usage 信息
            const lines = responseBuffer.split('\n')
            responseBuffer = lines.pop() ?? ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const dataStr = trimmed.slice(5).trim()
              if (!dataStr || dataStr === '[DONE]') continue
              try {
                const data = JSON.parse(dataStr)
                extractTokenUsage(data, (inp, out) => {
                  if (inp != null) inputTokens = inp
                  if (out != null) outputTokens = out
                })
              } catch {
                // 忽略解析失败的 chunk
              }
            }
          }
        }

        if (!res.writableEnded) {
          res.write(chunk)
        }
      })

      upstreamRes.on('end', () => {
        if (idleTimer) clearTimeout(idleTimer)

        // 非流式响应：从完整 body 解析 usage
        if (!isStreaming && disposition === 'success' && responseBuffer) {
          try {
            const data = JSON.parse(responseBuffer)
            extractTokenUsage(data, (inp, out) => {
              if (inp != null) inputTokens = inp
              if (out != null) outputTokens = out
            })
          } catch {
            // 忽略解析失败
          }
        }

        if (!res.writableEnded) {
          res.end()
        }
        void recordAttempt(disposition === 'success' ? 'success' : 'failed')
        resolve({
          disposition,
          statusCode,
          durationMilliseconds: Date.now() - attemptStartedAt,
          ttftMilliseconds,
          inputTokens,
          outputTokens,
          cacheHit,
        })
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

/**
 * 从 API 响应数据中提取 token 用量信息。
 * 支持多种格式：
 * - OpenAI Chat/Completions: data.usage.prompt_tokens / completion_tokens
 * - OpenAI Responses: data.usage.input_tokens / output_tokens
 * - Anthropic Messages (non-stream): data.usage.input_tokens / output_tokens
 * - Anthropic SSE message_start: data.message.usage.input_tokens
 * - Anthropic SSE message_delta: data.usage.output_tokens
 * - 通用格式: data.input_tokens / data.output_tokens / data.usage.total_tokens
 */
function extractTokenUsage(data: Record<string, unknown>, callback: (inputTokens: number | null, outputTokens: number | null) => void): void {
  let inp: number | null = null
  let out: number | null = null

  // 顶层 usage 对象（OpenAI / Anthropic 非流式）
  const usage = data.usage
  if (usage && typeof usage === 'object') {
    const u = usage as Record<string, unknown>
    // 输入 token
    if (typeof u.prompt_tokens === 'number') inp = u.prompt_tokens
    else if (typeof u.input_tokens === 'number') inp = u.input_tokens

    // 输出 token
    if (typeof u.completion_tokens === 'number') out = u.completion_tokens
    else if (typeof u.output_tokens === 'number') out = u.output_tokens

    // 如果只有 total_tokens，且只有一个有值，用 total 推算
    if (inp === null && out === null && typeof u.total_tokens === 'number') {
      inp = u.total_tokens
    }
  }

  // Anthropic SSE: message_start
  if (data.type === 'message_start') {
    const msg = data.message as Record<string, unknown> | undefined
    if (msg && msg.usage && typeof msg.usage === 'object') {
      const u = msg.usage as Record<string, unknown>
      if (typeof u.input_tokens === 'number') inp = u.input_tokens
    }
  }

  // Anthropic SSE: message_delta
  if (data.type === 'message_delta') {
    const u = data.usage as Record<string, unknown> | undefined
    if (u && typeof u.output_tokens === 'number') out = u.output_tokens
  }

  // OpenAI Responses 格式：output 数组中的 usage
  if (Array.isArray(data.output)) {
    for (const item of data.output as Array<Record<string, unknown>>) {
      if (item && typeof item === 'object' && item.usage && typeof item.usage === 'object') {
        const u = item.usage as Record<string, unknown>
        if (typeof u.input_tokens === 'number' && inp === null) inp = u.input_tokens
        if (typeof u.output_tokens === 'number') out = u.output_tokens
      }
    }
  }

  // 顶层直接有 token 字段（某些兼容 API）
  if (inp === null && typeof data.input_tokens === 'number') inp = data.input_tokens
  if (inp === null && typeof data.prompt_tokens === 'number') inp = data.prompt_tokens
  if (out === null && typeof data.output_tokens === 'number') out = data.output_tokens
  if (out === null && typeof data.completion_tokens === 'number') out = data.completion_tokens

  if (inp !== null || out !== null) {
    callback(inp, out)
  }
}
