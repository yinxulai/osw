import http from 'node:http'
import { URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAvailableModels, detectProtocolFromPath, findEndpoint, findConvertibleEndpoint } from './router'
import { markProviderSuccess, markProviderFailure, markProviderModelSuccess, markProviderModelFailure } from './health'
import { getSettings, listLogicalModels, createRequestLog, createRequestAttempt, createRequestContent, updateRequestContent, updateRequestLogStatus, replaceRequestUsage, pruneRequestLogs } from '../database/store'
import { generateId } from '@common/utils'
import type { ModelWithProvider } from './router'
import type { Protocol, RawUsage, RequestStatus } from '@common/schemas'
import { resolveUpstreamUrl, validateLogicalModel } from './request'
import { classifyHealthFailure, classifyUpstreamStatus } from './response'
import { createAuthHeaders } from './auth'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { createDownstreamHeaders, createUpstreamHeaders, redactHeaders } from './headers'
import type { UpstreamStatusDisposition } from './response'
import { attachDownstreamAbort, attachResponseIdleTimeout, sendUpstreamRequest } from './transport'
import { createRequestContext } from './request-context'
import { protocolAdapters } from './protocols/registry'
import { ResponsePipeline } from './response-pipeline'
import type { ProxyObservationHooks } from './hooks'
import { runAttemptQueue } from './attempt-runner'

class ClientRequestCancelledError extends Error {
  readonly code = 'CLIENT_REQUEST_ABORTED'

  constructor() {
    super('客户端已取消请求')
    this.name = 'ClientRequestCancelledError'
  }
}

class RecordedAttemptError extends Error {
  readonly outcome: AttemptOutcome

  constructor(cause: Error, outcome: AttemptOutcome) {
    super(cause.message)
    this.name = 'RecordedAttemptError'
    this.cause = cause
    this.outcome = outcome
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
  responseStatus?: number
  responseHeaders?: string
  responseBody?: string | null
  captureStatus?: 'captured' | 'partial'
}

async function recordHealthFailure(target: ModelWithProvider, statusCode: number | null, responseBody?: string | null): Promise<void> {
  const scope = classifyHealthFailure(statusCode, responseBody)
  if (scope === 'provider') await markProviderFailure(target.provider.id)
  if (scope === 'provider-model') await markProviderModelFailure(target.model.id)
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
export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse, logicalModelId: string, hooks: ProxyObservationHooks = {}): Promise<void> {
  const requestId = generateId('req_')
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
  const modelValidationError = validateLogicalModel(requestBody)
  if (modelValidationError) {
    writeJsonError(res, 400, 'INVALID_MODEL', modelValidationError)
    return
  }

  const requestedModel = (JSON.parse(requestBody.toString('utf8')) as { model: string }).model.trim()
  const logicalModels = await listLogicalModels()
  const resolvedLogicalModel = logicalModels.find(model =>
    model.enabled && (model.id === requestedModel || model.name === requestedModel),
  ) ?? logicalModels.find(model => model.enabled && model.name === 'default')
  if (!resolvedLogicalModel) {
    writeJsonError(res, 503, 'NO_MODEL_CONFIGURED', '还没有配置已启用的 default 逻辑模型')
    return
  }
  logicalModelId = resolvedLogicalModel.id
  const requestContext = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: req.method ?? 'POST',
    path: req.url ?? '/',
    requestBody,
    request: req,
  })
  await hooks.onRequestStarted?.(requestContext)

  // 过滤当前协议可用的候选，保持 scheduling policy 返回的优先级顺序。
  const availableModels = await getAvailableModels(logicalModelId)
  let models = availableModels.filter(m =>
    Boolean(findEndpoint(m.model, protocol) || findConvertibleEndpoint(m.model, protocol)),
  )

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
      ? '该逻辑模型队列没有已启用且健康的供应商模型'
      : `可用供应商模型未配置 ${protocol} 协议且未开启协议转换（当前配置协议: ${configuredProtocols.join(', ') || '无'}）`
    console.warn(
      `[proxy] 没有可用的上游 Provider: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${logicalModelId}, requestId=${requestId}, reason=${reason})`,
    )
    writeJsonError(res, 503, 'NO_AVAILABLE_PROVIDER', `没有可用的上游 Provider：${reason}`)
    return
  }

  const startedAt = Date.now()
  const settings = await getSettings()
  let requestContentId: string | null = null

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
    if (settings.captureRequestContent) {
      const content = await createRequestContent({
        requestId,
        attemptId: null,
        captureStatus: 'partial',
        requestMethod: req.method ?? 'POST',
        requestPath: req.url ?? '/',
        requestHeaders: JSON.stringify(redactHeaders(req.headers)),
        requestBody: requestBody.toString('utf8'),
        responseStatus: null,
        responseHeaders: null,
        responseBody: null,
        conversions: null,
      })
      requestContentId = content.id
    }
  } catch (error) {
    console.error(`[proxy] 写入请求日志失败: ${(error as Error).message}`)
  }

  await runAttemptQueue<ModelWithProvider, AttemptOutcome>({
    request: req,
    targets: models,
    attempt: (target, attemptIndex) => attemptRequest(req, res, target, protocol, requestBody, requestId, logicalModelId, attemptIndex, hooks),
    onSuccess: async (target, outcome, attemptIndex) => {

      if (outcome.disposition === 'success') {
        console.log(
          `[proxy] 透传成功: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await markProviderSuccess(target.provider.id)
        await markProviderModelSuccess(target.model.id)
        await finalizeRequestContent(requestContentId, outcome)
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
    },
    onTerminal: async (target, outcome) => {
        console.log(
          `[proxy] 请求终止(无重试): ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await finalizeRequestContent(requestContentId, outcome)
        await finalizeRequestLog(requestId, 'failed', startedAt)
    },
    onRetry: async (target, outcome, attemptIndex) => {
      console.warn(
        `[proxy] 上游返回可重试状态: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode})`,
      )
      await recordHealthFailure(target, outcome.statusCode, outcome.errorResponse)
    },
    onError: async (target, err, attemptIndex) => {
      const lastError = err instanceof Error ? err : new Error(String(err))
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
        return false
      }
      console.error(
        `[proxy] 上游请求失败: ${req.method} ${req.url} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}) error=${lastError.message}`,
      )
      try {
        const snapshot = resolveAttemptSnapshot(target, protocol)
        if (!(err instanceof RecordedAttemptError)) {
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
        }
      } catch (logError) {
        console.error(`[proxy] 写入请求尝试日志失败: ${(logError as Error).message}`)
      }
      const recordedOutcome = err instanceof RecordedAttemptError ? err.outcome : null
      await recordHealthFailure(target, recordedOutcome?.statusCode ?? null, recordedOutcome?.errorResponse)
      if (res.headersSent) {
        if (err instanceof RecordedAttemptError) await finalizeRequestContent(requestContentId, err.outcome)
        res.destroy(lastError)
        await finalizeRequestLog(requestId, 'failed', startedAt)
        return false
      }
      return true
    },
    onCancelled: async () => {
      await finalizeRequestLog(requestId, 'cancelled', startedAt)
    },
    onExhausted: async lastError => {

      if (!res.headersSent) {
        console.error(
          `[proxy] 所有上游 Provider 均失败: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${logicalModelId}, requestId=${requestId}) error=${lastError?.message}`,
        )
        const responseBody = writeJsonError(
          res,
          502,
          'ALL_PROVIDERS_FAILED',
          lastError?.message ?? '所有上游 Provider 都失败了',
        )
        await finalizeLocalErrorContent(requestContentId, 502, res, responseBody)
      }
      await finalizeRequestLog(requestId, 'failed', startedAt)
    },
  })
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

interface AttemptContentInput {
  attemptId: string | null
  captureStatus: 'captured' | 'partial'
  responseStatus: number | null
  responseHeaders: http.IncomingHttpHeaders | null
  responseBody: string | null
  convertedResponseBody?: string | null
}

type AttemptUsageInput = Pick<RequestLogMetrics, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheCreationInputTokens' | 'rawUsage'>

async function finalizeRequestLog(requestId: string, status: RequestStatus, startedAt: number, metrics?: RequestLogMetrics): Promise<void> {
  try {
    const totalDuration = Date.now() - startedAt
    const hasTokens = metrics?.inputTokens != null && metrics?.outputTokens != null
    const totalTokens = hasTokens ? (metrics!.inputTokens! + metrics!.outputTokens!) : null
    const update: Parameters<typeof updateRequestLogStatus>[1] = {
      status,
      totalDurationMilliseconds: totalDuration,
    }
    if (metrics) Object.assign(update, {
      totalTokens,
      inputTokens: metrics.inputTokens ?? null,
      outputTokens: metrics.outputTokens ?? null,
      cachedInputTokens: metrics.cachedInputTokens ?? null,
      cacheCreationInputTokens: metrics.cacheCreationInputTokens ?? null,
      promptCacheHit: metrics.promptCacheHit ?? null,
      rawUsage: metrics.rawUsage ?? null,
      ttftMilliseconds: metrics.ttftMilliseconds ?? null,
      upstreamProtocol: metrics.upstreamProtocol ?? null,
    })
    await updateRequestLogStatus(requestId, update)
    const settings = await getSettings()
    await pruneRequestLogs(settings.logRetentionDays)
  } catch (error) {
    console.error(`[proxy] 更新请求日志失败: ${(error as Error).message}`)
  }
}

async function finalizeRequestContent(contentId: string | null, outcome: AttemptOutcome): Promise<void> {
  if (!contentId) return
  try {
    await updateRequestContent(contentId, {
      captureStatus: outcome.captureStatus ?? 'captured',
      responseStatus: outcome.responseStatus ?? outcome.statusCode,
      responseHeaders: outcome.responseHeaders ?? null,
      responseBody: outcome.responseBody ?? null,
    })
  } catch (error) {
    console.error(`[proxy] 更新请求正文失败: ${(error as Error).message}`)
  }
}

async function finalizeLocalErrorContent(contentId: string | null, statusCode: number, res: ServerResponse, responseBody: string): Promise<void> {
  if (!contentId) return
  try {
    await updateRequestContent(contentId, {
      captureStatus: 'captured',
      responseStatus: statusCode,
      responseHeaders: JSON.stringify(redactHeaders(res.getHeaders())),
      responseBody,
    })
  } catch (error) {
    console.error(`[proxy] 更新请求正文失败: ${(error as Error).message}`)
  }
}

async function attemptRequest(req: IncomingMessage, res: ServerResponse, target: ModelWithProvider, protocol: Protocol, requestBody: Buffer, requestId: string, logicalModelId: string, attemptIndex: number, hooks: ProxyObservationHooks): Promise<AttemptOutcome> {
  const { model, provider } = target
  const settings = await getSettings()

  const nativeEndpoint = findEndpoint(model, protocol)
  const convertibleEndpoint = nativeEndpoint ? undefined : findConvertibleEndpoint(model, protocol)
  const endpoint = nativeEndpoint ?? convertibleEndpoint
  if (!endpoint) throw new Error(`模型 ${model.modelName} 不支持协议 ${protocol}`)
  const endpointProtocol = endpoint.protocol

  const targetUrl = resolveUpstreamUrl(endpoint.upstreamUrl)
  const parsed = new URL(targetUrl)
  const controller = new AbortController()
  const requestContext = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: req.method ?? 'POST',
    path: req.url ?? '/',
    requestBody,
    request: req,
    signal: controller.signal,
  })
  const adapter = protocolAdapters.resolve(protocol, endpointProtocol)
  const upstreamBody = adapter.prepareRequest(requestContext, model.modelName)
  const apiKey = await getSecretStore().get(provider.apiKeyReference)

  const isHttps = parsed.protocol === 'https:'

  const headers = createUpstreamHeaders(
    req.headers,
    createAuthHeaders(endpointProtocol, apiKey, endpoint.customAuthHeader),
    upstreamBody.length,
  )

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
  const recordAttempt = async (status: RequestStatus, httpStatus: number | null, retryable: boolean, errorCode?: string, errorMessage?: string, providerRequestId?: string | null, details?: string | null, usage?: AttemptUsageInput) => {
    try {
      const attempt = await createRequestAttempt({
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
      const hasTokens = usage?.inputTokens != null && usage?.outputTokens != null
      await replaceRequestUsage({
        requestId,
        attemptId: attempt.id,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: hasTokens ? usage!.inputTokens! + usage!.outputTokens! : null,
        cachedInputTokens: usage?.cachedInputTokens ?? null,
        cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
        rawUsage: usage?.rawUsage ?? null,
      })
      await hooks.onAttemptRecorded?.({
        requestId,
        attemptIndex,
        status,
        httpStatus,
        retryable,
        providerId: target.provider.id,
        providerModelId: target.model.id,
        providerProtocol: snapshot.providerProtocol,
        durationMilliseconds: Date.now() - attemptStartedAt,
        usage: {
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          cachedInputTokens: usage?.cachedInputTokens ?? null,
          cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
          rawUsage: usage?.rawUsage ?? null,
        },
      })
      return attempt
    } catch (error) {
      console.error(`[proxy] 写入请求尝试日志失败: ${(error as Error).message}`)
      return null
    }
  }

  const recordAttemptContent = async (input: AttemptContentInput) => {
    if (!settings.captureRequestContent || !input.attemptId) return
    try {
      await createRequestContent({
        requestId,
        attemptId: input.attemptId,
        captureStatus: input.captureStatus,
        requestMethod: req.method ?? 'POST',
        requestPath: parsed.pathname + parsed.search,
        requestHeaders: JSON.stringify(redactHeaders(headers, endpoint.customAuthHeader ? [endpoint.customAuthHeader] : [])),
        requestBody: upstreamBody.toString('utf8'),
        responseStatus: input.responseStatus,
        responseHeaders: input.responseHeaders ? JSON.stringify(redactHeaders(input.responseHeaders)) : null,
        responseBody: input.responseBody,
        conversions: adapter.requiresResponseConversion ? JSON.stringify({
          schemaVersion: 1,
          fromProtocol: protocol,
          toProtocol: endpointProtocol,
          convertedRequestBody: upstreamBody.toString('utf8'),
          convertedResponseBody: input.convertedResponseBody ?? null,
        }) : null,
      })
      await hooks.onContentCaptured?.({
        requestId,
        attemptId: input.attemptId,
        captureStatus: input.captureStatus,
        responseStatus: input.responseStatus ?? null,
        responseBody: input.responseBody ?? null,
      })
    } catch (error) {
      console.error(`[proxy] 写入请求正文失败: ${(error as Error).message}`)
    }
  }

  return new Promise<AttemptOutcome>((resolve, reject) => {
    let settled = false
    let downstreamAbort: { dispose(): void } | null = null
    const cleanupClientListeners = () => downstreamAbort?.dispose()
    const rejectCancelled = () => {
      if (settled) return
      settled = true
      cleanupClientListeners()
      reject(new ClientRequestCancelledError())
    }
    const onAbort = () => {
      controller.abort()
      rejectCancelled()
    }

    if (req.aborted || res.destroyed) {
      rejectCancelled()
      return
    }

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

    const upstreamRequest = sendUpstreamRequest(parsed, options, upstreamBody, {
      onResponse: upstreamRes => {
      const statusCode = upstreamRes.statusCode ?? 502
      const disposition = classifyUpstreamStatus(statusCode)

      // TTFT 由响应管线记录，Prompt Cache 仅从响应 usage 读取。
      let ttftMilliseconds: number | undefined
      let errorResponse = ''
      const upstreamChunks: string[] = []
      const upstreamRequestId = extractUpstreamRequestId(upstreamRes.headers)

      const contentType = String(upstreamRes.headers['content-type'] ?? '')
      const isStreaming = contentType.includes('text/event-stream')

      if (disposition === 'retry') {
        const idleTimeout = attachResponseIdleTimeout(upstreamRes, settings.idleTimeoutMilliseconds)
        upstreamRes.on('data', chunk => {
          const chunkText = chunk.toString('utf8')
          if (settings.captureRequestContent) upstreamChunks.push(chunkText)
          errorResponse = appendLimited(errorResponse, chunkText)
        })
        upstreamRes.on('end', async () => {
          idleTimeout.dispose()
          const body = errorResponse || null
          const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(body)
          const attempt = await recordAttempt('failed', statusCode, true, `Status_${statusCode}`, `上游返回 ${statusCode}`, resolvedRequestId, body)
          await recordAttemptContent({ attemptId: attempt?.id ?? null, captureStatus: 'captured', responseStatus: statusCode, responseHeaders: upstreamRes.headers, responseBody: serializeCapturedBody(isStreaming, upstreamChunks, body) })
          resolveAttempt({ disposition: 'retry', statusCode, durationMilliseconds: Date.now() - attemptStartedAt, upstreamRequestId: resolvedRequestId, errorResponse: body })
        })
        upstreamRes.on('error', err => {
          idleTimeout.dispose()
          if (settled) return
          void (async () => {
            const attempt = await recordAttempt('failed', statusCode, true, 'UPSTREAM_STREAM_ERROR', err.message, upstreamRequestId, errorResponse || null)
            await recordAttemptContent({
              attemptId: attempt?.id ?? null,
              captureStatus: 'partial',
              responseStatus: statusCode,
              responseHeaders: upstreamRes.headers,
              responseBody: serializeCapturedBody(isStreaming, upstreamChunks, errorResponse || null),
            })
            rejectAttempt(new RecordedAttemptError(err, {
              disposition: 'retry',
              statusCode,
              durationMilliseconds: Date.now() - attemptStartedAt,
              upstreamRequestId,
              errorResponse: errorResponse || null,
              captureStatus: 'partial',
            }))
          })()
        })
        upstreamRes.resume()
        return
      }

      const idleTimeout = attachResponseIdleTimeout(upstreamRes, settings.idleTimeoutMilliseconds)

      // 转发响应头
      if (!res.headersSent) {
        const downstreamHeaders = createDownstreamHeaders(upstreamRes.headers)
        if (adapter.requiresResponseConversion) {
          // 转换路径：响应体结构会变，移除上游长度限制头
          delete downstreamHeaders['content-length']
        }
        res.writeHead(statusCode, downstreamHeaders)
      }

      const responsePipeline = new ResponsePipeline({
        adapter,
        isStreaming,
        captureEnabled: settings.captureRequestContent,
        response: res,
        upstreamHeaders: upstreamRes.headers,
        onUsage: () => undefined,
        onUpstreamChunk: () => undefined,
        onDownstreamChunk: () => undefined,
      })

      upstreamRes.on('data', chunk => {
        const chunkText = chunk.toString('utf8')

        // 记录 TTFT（第一个数据块到达时间）
        if (ttftMilliseconds === undefined) {
          ttftMilliseconds = Date.now() - attemptStartedAt
        }

        if (disposition !== 'success') {
          errorResponse = appendLimited(errorResponse, chunk.toString('utf8'))
        }
        responsePipeline.push(chunkText, disposition === 'success')
      })

      upstreamRes.on('end', async () => {
        idleTimeout.dispose()

        const pipelineResult = responsePipeline.finish(disposition === 'success', errorResponse || null)
        const body = disposition === 'success' ? null : (errorResponse || null)
        const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(pipelineResult.upstreamBody)
        const attempt = await recordAttempt(
          disposition === 'success' ? 'success' : 'failed',
          statusCode,
          false,
          disposition === 'success' ? undefined : `Status_${statusCode}`,
          disposition === 'success' ? undefined : `上游返回 ${statusCode}`,
          resolvedRequestId,
          body,
          pipelineResult.usage,
        )
        await recordAttemptContent({ attemptId: attempt?.id ?? null, captureStatus: 'captured', responseStatus: statusCode, responseHeaders: upstreamRes.headers, responseBody: pipelineResult.upstreamBody, convertedResponseBody: adapter.requiresResponseConversion ? pipelineResult.downstreamBody : null })
        resolveAttempt({
          disposition,
          statusCode,
          durationMilliseconds: Date.now() - attemptStartedAt,
          upstreamRequestId: resolvedRequestId,
          errorResponse: body,
          ttftMilliseconds,
          ...pipelineResult.usage,
          promptCacheHit: pipelineResult.usage.cachedInputTokens == null ? null : pipelineResult.usage.cachedInputTokens > 0,
          upstreamProtocol: adapter.requiresResponseConversion ? endpointProtocol : null,
          responseStatus: statusCode,
          responseHeaders: JSON.stringify(redactHeaders(createDownstreamHeaders(upstreamRes.headers))),
          responseBody: pipelineResult.downstreamBody,
          captureStatus: 'captured',
        })
      })

      upstreamRes.on('error', err => {
        idleTimeout.dispose()
        if (settled) return
        void (async () => {
          const attempt = await recordAttempt(
            'failed',
            statusCode,
            false,
            'UPSTREAM_STREAM_ERROR',
            err.message,
            upstreamRequestId,
            null,
            responsePipeline.getUsage(),
          )
          await recordAttemptContent({
            attemptId: attempt?.id ?? null,
            captureStatus: 'partial',
            responseStatus: statusCode,
            responseHeaders: upstreamRes.headers,
            responseBody: responsePipeline.partialBody(),
          })
          rejectAttempt(new RecordedAttemptError(err, {
            disposition,
            statusCode,
            durationMilliseconds: Date.now() - attemptStartedAt,
            upstreamRequestId,
            responseStatus: statusCode,
            responseHeaders: JSON.stringify(redactHeaders(createDownstreamHeaders(upstreamRes.headers))),
            responseBody: responsePipeline.partialBody(),
            captureStatus: 'partial',
          }))
        })()
      })
      },
      onError: err => {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        rejectCancelled()
        return
      }
      rejectAttempt(err)
      },
      onTimeout: request => request.destroy(new Error('Connection timeout')),
    })
    downstreamAbort = attachDownstreamAbort(req, res, upstreamRequest, onAbort)

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

function serializeStreamingChunks(chunks: string[]): string {
  return JSON.stringify({ schemaVersion: 1, chunks })
}

function serializeCapturedBody(isStreaming: boolean, chunks: string[], body: string | null): string | null {
  return isStreaming ? serializeStreamingChunks(chunks) : body
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

function writeJsonError(res: ServerResponse, statusCode: number, errorCode: string, errorMessage: string): string {
  const body = JSON.stringify({
    success: false,
    errorCode,
    errorMessage,
  })
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(body)
  return body
}
