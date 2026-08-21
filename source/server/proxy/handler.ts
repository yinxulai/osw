import http from 'node:http'
import { URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAvailableModels, detectProtocolFromPath, findEndpoint, findConvertibleEndpoint } from './router'
import { convertRequestBody } from './conversion'
import { convertResponseBody, createSseConverter } from './conversion-response'
import { markProviderSuccess, markProviderFailure, markProviderModelSuccess, markProviderModelFailure } from './health'
import { getSettings, createRequestLog, createRequestAttempt, updateRequestLogStatus, pruneRequestLogs } from '../database/store'
import { generateId } from '@common/utils'
import type { ModelWithProvider } from './router'
import type { Protocol, RawUsage, RequestStatus } from '@common/schemas'
import { resolveUpstreamUrl, validateLogicalModel, rewriteRequestModel, injectUsageParams } from './request'
import { classifyUpstreamStatus } from './response'
import { createAuthHeaders } from './auth'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { createDownstreamHeaders, createUpstreamHeaders } from './headers'
import type { UpstreamStatusDisposition } from './response'
import { sendUpstreamRequest } from './transport'

class ClientRequestCancelledError extends Error {
  readonly code = 'CLIENT_REQUEST_ABORTED'

  constructor() {
    super('客户端已取消请求')
    this.name = 'ClientRequestCancelledError'
  }
}

function isClientRequestCancelled(error: unknown): boolean {
  return error instanceof ClientRequestCancelledError || (
    error instanceof Error && error.message === 'CLIENT_REQUEST_ABORTED'
  )
}

interface AttemptOutcome {
  disposition: UpstreamStatusDisposition
  statusCode: number
  durationMilliseconds: number
  errorCode?: string
  errorMessage?: string
  upstreamRequestId?: string | null
  errorResponse?: string | null
  ttftMilliseconds?: number
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  promptCacheHit?: boolean | null
  rawUsage?: RawUsage | null
  upstreamProtocol?: Protocol | null
}

const manualModelIds = new Map<string, string>()

export function setManualModel(logicalModelId: string, providerModelId: string | null): void {
  if (providerModelId === null) {
    manualModelIds.delete(logicalModelId)
    return
  }
  manualModelIds.set(logicalModelId, providerModelId)
}

export function getManualModel(logicalModelId: string): string | null {
  return manualModelIds.get(logicalModelId) ?? null
}

export function resetManualModels(): void {
  manualModelIds.clear()
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

  const requestBody = await readRequestBody(req)
  if (req.aborted) return
  const modelValidationError = validateLogicalModel(requestBody, logicalModelId)
  if (modelValidationError) {
    writeJsonError(res, 400, 'INVALID_MODEL', modelValidationError)
    return
  }

  // 获取当前逻辑模型绑定的可用 models：原生协议候选优先，其后是开启了协议转换的候选
  const availableModels = await getAvailableModels(logicalModelId)
  const nativeModels = availableModels.filter(m => findEndpoint(m.model, protocol))
  const convertedModels = availableModels.filter(m =>
    !findEndpoint(m.model, protocol)
    && findConvertibleEndpoint(m.model, protocol),
  )
  let models = [...nativeModels, ...convertedModels]

  // 手动选择只改变本次请求的起始位置，不改变队列顺序。
  const manualModelId = getManualModel(logicalModelId)
  if (manualModelId) {
    const manualIndex = models.findIndex(candidate => candidate.model.id === manualModelId)
    if (manualIndex === -1) {
      writeJsonError(res, 409, 'MANUAL_MODEL_UNAVAILABLE', '手动指定的 ProviderModel 当前不可用于该协议')
      return
    }
    models = models.slice(manualIndex)
  }

  if (models.length === 0) {
    const configuredProtocols = [...new Set(
      availableModels.flatMap(candidate => candidate.model.endpoints.map(endpoint => endpoint.protocol)),
    )]
    const reason = availableModels.length === 0
      ? '该逻辑模型队列没有已启用且健康的上游模型'
      : `可用上游模型未配置 ${protocol} 协议且未开启协议转换（当前配置协议: ${configuredProtocols.join(', ') || '无'}）`
    console.warn(
      `[proxy] 没有可用的上游 Provider: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${logicalModelId}, requestId=${requestId}, reason=${reason})`,
    )
    writeJsonError(res, 503, 'NO_AVAILABLE_PROVIDER', `没有可用的上游 Provider：${reason}`)
    return
  }

  const startedAt = Date.now()

  // 先创建请求日志（占位状态），供各 attempt 作为外键引用，结束时再更新为最终状态
  try {
    await createRequestLog({
      id: requestId,
      logicalModelId,
      protocol,
      upstreamProtocol: null,
      status: 'pending',
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
    if (req.aborted) {
      await finalizeRequestLog(requestId, 'cancelled', startedAt)
      return
    }
    try {
      const outcome = await attemptRequest(req, res, target, protocol, requestBody, requestId, attemptIndex)

      if (outcome.disposition === 'success') {
        console.log(
          `[proxy] 透传成功: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await markProviderSuccess(target.provider.id)
        await markProviderModelSuccess(target.model.id)
        await finalizeRequestLog(requestId, 'success', startedAt, {
          ttftMilliseconds: outcome.ttftMilliseconds ?? null,
          inputTokens: outcome.inputTokens ?? null,
          outputTokens: outcome.outputTokens ?? null,
          cachedInputTokens: outcome.cachedInputTokens ?? null,
          cacheCreationInputTokens: outcome.cacheCreationInputTokens ?? null,
          promptCacheHit: outcome.promptCacheHit ?? null,
          rawUsage: outcome.rawUsage ?? null,
          upstreamProtocol: outcome.upstreamProtocol ?? null,
        })
        return
      }
      if (outcome.disposition === 'terminal') {
        console.log(
          `[proxy] 请求终止(无重试): ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await finalizeRequestLog(requestId, 'failed', startedAt)
        return
      }

      console.warn(
        `[proxy] 上游返回可重试状态: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode})`,
      )
      await markProviderFailure(target.provider.id)
      await markProviderModelFailure(target.model.id)
      attemptIndex++
    } catch (err) {
      lastError = err as Error
      if (isClientRequestCancelled(err)) {
        try {
          const snapshot = resolveAttemptSnapshot(target, protocol)
          await createRequestAttempt({
            requestId,
            ...snapshot,
            attemptIndex,
            status: 'cancelled',
            httpStatus: null,
            retryable: false,
            errorCode: 'CLIENT_REQUEST_ABORTED',
            errorMessage: lastError.message,
            providerRequestId: null,
            details: null,
            durationMilliseconds: Date.now() - startedAt,
          })
        } catch (logError) {
          console.error(`[proxy] 写入取消请求尝试日志失败: ${(logError as Error).message}`)
        }
        await finalizeRequestLog(requestId, 'cancelled', startedAt)
        return
      }
      console.error(
        `[proxy] 上游请求失败: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}) error=${lastError.message}`,
      )
      try {
        const snapshot = resolveAttemptSnapshot(target, protocol)
        await createRequestAttempt({
          requestId,
          ...snapshot,
          attemptIndex,
          status: 'failed',
          httpStatus: null,
          retryable: !res.headersSent,
          errorCode: 'UPSTREAM_ERROR',
          errorMessage: lastError.message,
          providerRequestId: null,
          details: null,
          durationMilliseconds: Date.now() - startedAt,
        })
      } catch (logError) {
        console.error(`[proxy] 写入请求尝试日志失败: ${(logError as Error).message}`)
      }
      await markProviderFailure(target.provider.id)
      await markProviderModelFailure(target.model.id)
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
  upstreamProtocol?: Protocol | null
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
      upstreamProtocol: metrics?.upstreamProtocol ?? null,
    })
    const settings = await getSettings()
    await pruneRequestLogs(settings.logRetentionCount, settings.logRetentionDays)
  } catch (error) {
    console.error(`[proxy] 更新请求日志失败: ${(error as Error).message}`)
  }
}

async function attemptRequest(req: IncomingMessage, res: ServerResponse, target: ModelWithProvider, protocol: Protocol, requestBody: Buffer, requestId: string, attemptIndex: number): Promise<AttemptOutcome> {
  const { model, provider } = target
  const settings = await getSettings()

  const nativeEndpoint = findEndpoint(model, protocol)
  const convertibleEndpoint = nativeEndpoint ? undefined : findConvertibleEndpoint(model, protocol)
  const endpoint = nativeEndpoint ?? convertibleEndpoint
  if (!endpoint) throw new Error(`模型 ${model.modelName} 不支持协议 ${protocol}`)
  const endpointProtocol = endpoint.protocol
  const converting = !nativeEndpoint

  const targetUrl = resolveUpstreamUrl(endpoint.upstreamUrl)
  const parsed = new URL(targetUrl)
  const upstreamBody = converting
    ? injectUsageParams(convertRequestBody(protocol, endpointProtocol, requestBody, model.modelName), endpointProtocol)
    : injectUsageParams(rewriteRequestModel(requestBody, model.modelName), endpointProtocol)
  const apiKey = await getSecretStore().get(provider.apiKeyReference)

  const isHttps = parsed.protocol === 'https:'

  const headers = createUpstreamHeaders(
    req.headers,
    createAuthHeaders(endpointProtocol, apiKey, endpoint.customAuthHeader),
    upstreamBody.length,
  )

  const controller = new AbortController()
  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers,
    timeout: provider.timeoutMilliseconds,
    signal: controller.signal,
  }

  const attemptStartedAt = Date.now()
  const snapshot = resolveAttemptSnapshot(target, protocol)
  const recordAttempt = async (status: RequestStatus, httpStatus: number | null, retryable: boolean, errorCode?: string, errorMessage?: string, providerRequestId?: string | null, details?: string | null) => {
    try {
      await createRequestAttempt({
        requestId,
        ...snapshot,
        attemptIndex,
        status,
        httpStatus,
        retryable,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        providerRequestId: providerRequestId ?? null,
        details: details ?? null,
        durationMilliseconds: Date.now() - attemptStartedAt,
      })
    } catch (error) {
      console.error(`[proxy] 写入请求尝试日志失败: ${(error as Error).message}`)
    }
  }

  return new Promise<AttemptOutcome>((resolve, reject) => {
    let settled = false
    const cleanupClientListeners = () => {
      req.removeListener('aborted', onClientAbort)
      res.removeListener('close', onDownstreamClose)
    }
    const rejectCancelled = () => {
      if (settled) return
      settled = true
      cleanupClientListeners()
      reject(new ClientRequestCancelledError())
    }
    const onClientAbort = () => {
      controller.abort()
      rejectCancelled()
    }
    const onDownstreamClose = () => {
      // A normal response emits close after writableEnded; only treat an
      // incomplete response as a client disconnect.
      if (!res.writableEnded) onClientAbort()
    }

    if (req.aborted || res.destroyed) {
      rejectCancelled()
      return
    }
    req.once('aborted', onClientAbort)
    res.once('close', onDownstreamClose)

    const rejectAttempt = (error: Error) => {
      if (settled) return
      settled = true
      cleanupClientListeners()
      reject(error)
    }
    const resolveAttempt = (outcome: AttemptOutcome) => {
      if (settled) return
      settled = true
      cleanupClientListeners()
      resolve(outcome)
    }

    const upstreamReq = sendUpstreamRequest(parsed, options, upstreamBody, upstreamRes => {
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
      let errorResponse = ''
      const upstreamRequestId = extractUpstreamRequestId(upstreamRes.headers)

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
        upstreamRes.on('data', chunk => {
          resetIdleTimer()
          errorResponse = appendLimited(errorResponse, chunk.toString('utf8'))
        })
        upstreamRes.on('end', () => {
          if (idleTimer) clearTimeout(idleTimer)
          const body = errorResponse || null
          const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(body)
          void recordAttempt('failed', statusCode, true, `Status_${statusCode}`, `上游返回 ${statusCode}`, resolvedRequestId, body)
          resolveAttempt({ disposition: 'retry', statusCode, durationMilliseconds: Date.now() - attemptStartedAt, upstreamRequestId: resolvedRequestId, errorResponse: body })
        })
        upstreamRes.on('error', err => {
          if (idleTimer) clearTimeout(idleTimer)
          rejectAttempt(err)
        })
        upstreamRes.resume()
        return
      }

      // 转发响应头
      if (!res.headersSent) {
        const downstreamHeaders = createDownstreamHeaders(upstreamRes.headers)
        if (converting) {
          // 转换路径：响应体结构会变，移除上游长度限制头
          delete downstreamHeaders['content-length']
        }
        res.writeHead(statusCode, downstreamHeaders)
      }

      // 协议转换流式转换器（非转换路径为透传）
      const sseConverter = converting && isStreaming
        ? createSseConverter(protocol, endpointProtocol)
        : null

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

        if (disposition !== 'success') {
          errorResponse = appendLimited(errorResponse, chunk.toString('utf8'))
        }
        if (!res.writableEnded) {
          if (sseConverter) {
            const converted = sseConverter.push(chunk.toString('utf8'))
            if (converted) res.write(converted)
          } else if (!converting || isStreaming) {
            // 非流式转换路径先缓冲原始响应，end 时统一转换后写出
            res.write(chunk)
          }
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
          if (sseConverter) {
            const tail = sseConverter.push('') + sseConverter.flush()
            if (tail) res.write(tail)
            // OpenAI 客户端期望 [DONE] 结束标记
            if (protocol === 'openai-completions') res.write('data: [DONE]\n\n')
          } else if (converting && !isStreaming && responseBuffer) {
            try {
              res.write(convertResponseBody(protocol, endpointProtocol, Buffer.from(responseBuffer)))
            } catch (error) {
              console.error(`[proxy] 响应转换失败: ${(error as Error).message}`)
              res.write(responseBuffer)
            }
          }
          res.end()
        }
        const body = disposition === 'success' ? null : (errorResponse || null)
        const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(responseBuffer)
        void recordAttempt(
          disposition === 'success' ? 'success' : 'failed',
          statusCode,
          false,
          disposition === 'success' ? undefined : `Status_${statusCode}`,
          disposition === 'success' ? undefined : `上游返回 ${statusCode}`,
          resolvedRequestId,
          body,
        )
        resolveAttempt({
          disposition,
          statusCode,
          durationMilliseconds: Date.now() - attemptStartedAt,
          upstreamRequestId: resolvedRequestId,
          errorResponse: body,
          ttftMilliseconds,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          cacheCreationInputTokens,
          promptCacheHit: cachedInputTokens == null ? null : cachedInputTokens > 0,
          rawUsage,
          upstreamProtocol: converting ? endpointProtocol : null,
        })
      })

      upstreamRes.on('error', err => {
        if (idleTimer) clearTimeout(idleTimer)
        rejectAttempt(err)
      })
    })

    upstreamReq.on('error', err => {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        rejectCancelled()
        return
      }
      rejectAttempt(err)
    })

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(new Error('Connection timeout'))
    })

  })
}

function resolveAttemptSnapshot(target: ModelWithProvider, clientProtocol: Protocol) {
  const endpoint = findEndpoint(target.model, clientProtocol) ?? findConvertibleEndpoint(target.model, clientProtocol)
  if (!endpoint) throw new Error(`模型 ${target.model.modelName} 不支持协议 ${clientProtocol}`)
  return {
    providerId: target.provider.id,
    providerModelId: target.model.id,
    providerName: target.provider.name,
    providerModelName: target.model.modelName,
    providerProtocol: endpoint.protocol,
    url: resolveUpstreamUrl(endpoint.upstreamUrl),
  }
}

const MAX_ERROR_RESPONSE_LENGTH = 64 * 1024

function appendLimited(current: string, incoming: string): string {
  if (current.length >= MAX_ERROR_RESPONSE_LENGTH) return current
  return (current + incoming).slice(0, MAX_ERROR_RESPONSE_LENGTH)
}

function extractUpstreamRequestId(headers: http.IncomingHttpHeaders): string | null {
  const candidates = [
    headers['x-request-id'],
    headers['request-id'],
    headers['anthropic-request-id'],
    headers['x-correlation-id'],
    headers['x-amzn-requestid'],
    headers['x-goog-request-id'],
  ]
  for (const value of candidates) {
    const id = Array.isArray(value) ? value[0] : value
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

function extractRequestIdFromBody(body: string | null): string | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    for (const key of ['id', 'request_id', 'requestId']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  } catch {
    // 非 JSON 错误响应没有可提取的请求 ID。
  }
  return null
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    req.on('data', chunk => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    req.on('aborted', () => fail(new Error('CLIENT_REQUEST_ABORTED')))
    req.on('error', error => fail(error))
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
