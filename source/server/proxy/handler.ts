import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAvailableModels, detectProtocolFromPath, findEndpoint } from './router'
import { markProviderSuccess, markProviderFailure } from './health'
import { getSettings, createRequestLog, createRequestAttempt, updateRequestLogStatus } from '../database/store'
import { generateId } from '@common/utils'
import type { ModelWithProvider } from './router'
import type { Protocol, RawUsage, RequestStatus } from '@common/schemas'
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
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  promptCacheHit?: boolean | null
  rawUsage?: RawUsage | null
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
  const availableModels = await getAvailableModels(logicalModelId)
  let models = availableModels.filter(m => findEndpoint(m.model, protocol))

  // 如果有手动指定的 model，把它排到最前面
  if (manualModelId) {
    const manual = models.find(m => m.model.id === manualModelId)
    if (manual) {
      models = [manual, ...models.filter(m => m.model.id !== manualModelId)]
    }
  }

  if (models.length === 0) {
    const configuredProtocols = [...new Set(
      availableModels.flatMap(candidate => candidate.model.endpoints.map(endpoint => endpoint.protocol)),
    )]
    const reason = availableModels.length === 0
      ? '该队列没有已启用且健康的上游模型'
      : `可用模型未绑定 ${protocol} 协议（当前绑定: ${configuredProtocols.join(', ') || '无'}）`
    console.warn(
      `[proxy] 没有可用的上游 Provider: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${logicalModelId}, requestId=${requestId}, reason=${reason})`,
    )
    writeJsonError(res, 503, 'NO_AVAILABLE_PROVIDER', `没有可用的上游 Provider：${reason}`)
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
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
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
          cachedInputTokens: outcome.cachedInputTokens ?? null,
          cacheCreationInputTokens: outcome.cacheCreationInputTokens ?? null,
          promptCacheHit: outcome.promptCacheHit ?? null,
          rawUsage: outcome.rawUsage ?? null,
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
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  promptCacheHit?: boolean | null
  rawUsage?: RawUsage | null
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
      cachedInputTokens: metrics?.cachedInputTokens ?? null,
      cacheCreationInputTokens: metrics?.cacheCreationInputTokens ?? null,
      promptCacheHit: metrics?.promptCacheHit ?? null,
      rawUsage: metrics?.rawUsage ?? null,
      ttftMilliseconds: metrics?.ttftMilliseconds ?? null,
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

      // TTFT 与 token 采集。Prompt Cache 仅从响应 usage 读取，不使用 HTTP/CDN cache headers。
      let ttftMilliseconds: number | undefined
      let inputTokens: number | null = null
      let outputTokens: number | null = null
      let cachedInputTokens: number | null = null
      let cacheCreationInputTokens: number | null = null
      let rawUsage: RawUsage | null = null
      let responseBuffer = ''

      const contentType = String(upstreamRes.headers['content-type'] ?? '')
      const isStreaming = contentType.includes('text/event-stream')
      const applyUsage = (data: Record<string, unknown>) => {
        const extracted = extractTokenUsage(data)
        if (extracted.inputTokens != null) inputTokens = extracted.inputTokens
        if (extracted.outputTokens != null) outputTokens = extracted.outputTokens
        if (extracted.cachedInputTokens != null) cachedInputTokens = extracted.cachedInputTokens
        if (extracted.cacheCreationInputTokens != null) {
          cacheCreationInputTokens = extracted.cacheCreationInputTokens
        }
        rawUsage = mergeRawUsage(rawUsage, extracted.rawUsage)
      }
      const applySseLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) return
        const dataStr = trimmed.slice(5).trim()
        if (!dataStr || dataStr === '[DONE]') return
        try {
          applyUsage(JSON.parse(dataStr) as Record<string, unknown>)
        } catch {
          // 忽略非 JSON SSE 事件
        }
      }

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
            for (const line of lines) applySseLine(line)
          }
        }

        if (!res.writableEnded) {
          res.write(chunk)
        }
      })

      upstreamRes.on('end', () => {
        if (idleTimer) clearTimeout(idleTimer)

        if (disposition === 'success' && responseBuffer) {
          if (isStreaming) {
            // 上游可能在最后一个 SSE event 后省略换行。
            applySseLine(responseBuffer)
          } else {
            try {
              applyUsage(JSON.parse(responseBuffer) as Record<string, unknown>)
            } catch {
              // 忽略解析失败
            }
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
          cachedInputTokens,
          cacheCreationInputTokens,
          promptCacheHit: cachedInputTokens == null ? null : cachedInputTokens > 0,
          rawUsage,
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

interface ExtractedUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  rawUsage: RawUsage | null
}

/** 提取原始 usage，并按费用规则标准化输入、缓存读取和缓存写入 Token。 */
function extractTokenUsage(data: Record<string, unknown>): ExtractedUsage {
  const usageCandidates: RawUsage[] = []
  collectUsage(data.usage, usageCandidates)
  collectUsage(asRecord(data.message)?.usage, usageCandidates)
  collectUsage(asRecord(data.response)?.usage, usageCandidates)

  if (Array.isArray(data.output)) {
    for (const item of data.output) collectUsage(asRecord(item)?.usage, usageCandidates)
  }

  let rawUsage: RawUsage | null = null
  for (const usage of usageCandidates) rawUsage = mergeRawUsage(rawUsage, usage)

  const inputTokens = firstNumber(
    rawUsage?.prompt_tokens,
    rawUsage?.input_tokens,
    rawUsage?.total_input_tokens,
    rawUsage?.promptTokenCount,
    data.input_tokens,
    data.prompt_tokens,
  )
  const outputTokens = firstNumber(
    rawUsage?.completion_tokens,
    rawUsage?.output_tokens,
    rawUsage?.total_output_tokens,
    rawUsage?.candidatesTokenCount,
    data.output_tokens,
    data.completion_tokens,
  )
  const cachedInputTokens = firstNumber(
    asRecord(rawUsage?.prompt_tokens_details)?.cached_tokens,
    asRecord(rawUsage?.input_tokens_details)?.cached_tokens,
    rawUsage?.cache_read_input_tokens,
    rawUsage?.cached_input_tokens,
    rawUsage?.cache_read_tokens,
    rawUsage?.cachedContentTokenCount,
  )
  const cacheCreation = asRecord(rawUsage?.cache_creation)
  const cacheCreationInputTokens = firstNumber(
    rawUsage?.cache_creation_input_tokens,
    rawUsage?.cache_creation_tokens,
    rawUsage?.cached_creation_input_tokens,
    sumNumbers(
      cacheCreation?.ephemeral_5m_input_tokens,
      cacheCreation?.ephemeral_1h_input_tokens,
    ),
  )

  return { inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens, rawUsage }
}

function collectUsage(value: unknown, target: RawUsage[]): void {
  const usage = asRecord(value)
  if (usage) target.push(usage)
}

function asRecord(value: unknown): RawUsage | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RawUsage
    : null
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function sumNumbers(...values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null
}

function mergeRawUsage(current: RawUsage | null, incoming: RawUsage | null): RawUsage | null {
  if (!incoming) return current
  if (!current) return { ...incoming }

  const merged: RawUsage = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = asRecord(merged[key])
    const incomingValue = asRecord(value)
    merged[key] = currentValue && incomingValue
      ? mergeRawUsage(currentValue, incomingValue)
      : value
  }
  return merged
}
