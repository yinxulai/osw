import http from 'node:http'
import { URL } from 'node:url'
import { markProviderSuccess, markProviderFailure, markProviderModelSuccess, markProviderModelFailure } from './health'
import { getSettings } from '../database/settings-store'
import { findConvertibleEndpoint, findEndpoint, type ModelWithProvider } from './router'
import type { Protocol, RawUsage } from '@common/schemas'
import { resolveUpstreamUrl } from './request'
import { classifyHealthFailure, classifyUpstreamStatus } from './response'
import { createAuthHeaders } from './auth'
import { getSecretStore } from '../infrastructure/secrets/secret-store'
import { createDownstreamHeaders, createUpstreamRequestHeaders, redactHeaders } from './headers'
import type { UpstreamStatusDisposition } from './response'
import { attachResponseIdleTimeout, sendUpstreamRequest } from './transport'
import { createRequestContext, type RequestContext } from './request-context'
import { protocolAdapters } from './protocols/registry'
import { ResponsePipeline } from './response-pipeline'
import type { ProxyObservationHooks } from './hooks'
import { runAttemptQueue } from './attempt-runner'
import type { ProxyResponse } from './proxy-response'
import { resolveAttemptSnapshot } from './routing'
import { createAttemptLogger, initializeRequestLogger } from './logging'

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

export interface ProxyExecutionOptions {
  context: RequestContext
  targets: ModelWithProvider[]
  response: ProxyResponse
  hooks?: ProxyObservationHooks
}

export async function executeProxyRequest(options: ProxyExecutionOptions): Promise<void> {
  const { context, targets, response, hooks = {} } = options
  const { requestId, logicalModelId, clientProtocol: protocol, requestBody } = context
  const startedAt = Date.now()
  const settings = await getSettings()
  const requestLogger = await initializeRequestLogger({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: context.method,
    path: context.path,
    headers: context.headers,
    requestBody,
    captureRequestContent: settings.captureRequestContent,
  })
  await runAttemptQueue<ModelWithProvider, AttemptOutcome>({
    signal: context.signal,
    targets,
    attempt: (target, attemptIndex) => attemptRequest(context, response, target, attemptIndex, hooks),
    onSuccess: async (target, outcome, attemptIndex) => {

      if (outcome.disposition === 'success') {
        console.log(
          `[proxy] 透传成功: ${context.method} ${context.path} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await markProviderSuccess(target.provider.id)
        await markProviderModelSuccess(target.model.id)
        await requestLogger.finalizeRequestContent(outcome)
        await requestLogger.finalizeRequestLog('success', startedAt, {
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
          `[proxy] 请求终止(无重�?: ${context.method} ${context.path} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, status=${outcome.statusCode}, duration=${outcome.durationMilliseconds}ms)`,
        )
        await requestLogger.finalizeRequestContent(outcome)
        await requestLogger.finalizeRequestLog('failed', startedAt)
    },
    onRetry: async (target, outcome, attemptIndex) => {
      console.warn(
        `[proxy] 上游返回可重试状�? ${context.method} ${context.path} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}, status=${outcome.statusCode})`,
      )
      await recordHealthFailure(target, outcome.statusCode, outcome.errorResponse)
    },
    onError: async (target, err, attemptIndex) => {
      const lastError = err instanceof Error ? err : new Error(String(err))
      if (isClientRequestCancelled(err)) {
        try {
          const snapshot = resolveAttemptSnapshot(target, protocol)
          await createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            snapshot,
            method: context.method,
            path: context.path,
            requestHeaders: context.headers,
            requestBody,
            upstreamRequestHeaders: {},
            upstreamRequestBody: Buffer.alloc(0),
            clientProtocol: protocol,
            upstreamProtocol: snapshot.upstreamProtocol,
            requiresResponseConversion: false,
            captureRequestContent: false,
            hooks: {},
          }).recordAttempt('cancelled', null, false, 'CLIENT_REQUEST_ABORTED', lastError.message)
        } catch (logError) {
          console.error(`[proxy] 写入取消请求尝试日志失败: ${(logError as Error).message}`)
        }
        await requestLogger.finalizeRequestLog('cancelled', startedAt)
        return false
      }
      console.error(
        `[proxy] 上游请求失败: ${context.method} ${context.path} -> ${target.provider.id}/${target.model.modelName} (protocol=${protocol}, requestId=${requestId}, attempt=${attemptIndex}) error=${lastError.message}`,
      )
      try {
        const snapshot = resolveAttemptSnapshot(target, protocol)
        if (!(err instanceof RecordedAttemptError)) {
          await createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            snapshot,
            method: context.method,
            path: context.path,
            requestHeaders: context.headers,
            requestBody,
            upstreamRequestHeaders: {},
            upstreamRequestBody: Buffer.alloc(0),
            clientProtocol: protocol,
            upstreamProtocol: snapshot.upstreamProtocol,
            requiresResponseConversion: false,
            captureRequestContent: false,
            hooks: {},
          }).recordAttempt('failed', null, !response.headersSent, 'UPSTREAM_ERROR', lastError.message)
        }
      } catch (logError) {
        console.error(`[proxy] 写入请求尝试日志失败: ${(logError as Error).message}`)
      }
      const recordedOutcome = err instanceof RecordedAttemptError ? err.outcome : null
      await recordHealthFailure(target, recordedOutcome?.statusCode ?? null, recordedOutcome?.errorResponse)
      if (response.headersSent) {
        if (err instanceof RecordedAttemptError) await requestLogger.finalizeRequestContent(err.outcome)
        response.destroy(lastError)
        await requestLogger.finalizeRequestLog('failed', startedAt)
        return false
      }
      return true
    },
    onCancelled: async () => {
      await requestLogger.finalizeRequestLog('cancelled', startedAt)
    },
    onExhausted: async lastError => {

      if (!response.headersSent) {
        console.error(
          `[proxy] 所�?Provider 均失�? ${context.method} ${context.path} (protocol=${protocol}, logicalModel=${logicalModelId}, requestId=${requestId}) error=${lastError?.message}`,
        )
        const responseBody = response.fail(
          502,
          'ALL_PROVIDERS_FAILED',
          lastError?.message ?? '所�?Provider 都失败了',
        )
        await requestLogger.finalizeLocalErrorContent(502, response.headers(), responseBody)
      }
      await requestLogger.finalizeRequestLog('failed', startedAt)
    },
  })
}

async function attemptRequest(context: RequestContext, response: ProxyResponse, target: ModelWithProvider, attemptIndex: number, hooks: ProxyObservationHooks): Promise<AttemptOutcome> {
  const { model, provider } = target
  const { requestId, logicalModelId, clientProtocol: protocol, requestBody } = context
  const settings = await getSettings()

  const nativeEndpoint = findEndpoint(model, protocol)
  const convertibleEndpoint = nativeEndpoint ? undefined : findConvertibleEndpoint(model, protocol)
  const endpoint = nativeEndpoint ?? convertibleEndpoint
  if (!endpoint) throw new Error(`模型 ${model.modelName} 不支持协�?${protocol}`)
  const endpointProtocol = endpoint.protocol

  const targetUrl = resolveUpstreamUrl(endpoint.endpointUrl)
  const parsed = new URL(targetUrl)
  const controller = new AbortController()
  const requestContext = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: context.method,
    path: context.path,
    headers: context.headers,
    requestBody,
    signal: controller.signal,
  })
  const adapter = protocolAdapters.resolve(protocol, endpointProtocol)
  const upstreamRequestBody = adapter.prepareRequest(requestContext, model.modelName)
  const apiKey = await getSecretStore().get(provider.apiKeyReference)

  const isHttps = parsed.protocol === 'https:'

  const headers = createUpstreamRequestHeaders(
    context.headers,
    createAuthHeaders(endpointProtocol, apiKey, endpoint.customAuthHeader),
    upstreamRequestBody.length,
  )

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: context.method,
    headers,
    timeout: provider.timeoutMilliseconds,
    signal: controller.signal,
  }

  const attemptStartedAt = Date.now()
  const snapshot = resolveAttemptSnapshot(target, protocol)
  const attemptLogger = createAttemptLogger({
    requestId,
    attemptIndex,
    startedAt: attemptStartedAt,
    snapshot,
    method: context.method,
    path: parsed.pathname + parsed.search,
    requestHeaders: context.headers,
    requestBody,
    upstreamRequestHeaders: headers,
    upstreamRequestBody,
    customAuthHeader: endpoint.customAuthHeader,
    clientProtocol: protocol,
    upstreamProtocol: endpointProtocol,
    requiresResponseConversion: adapter.requiresResponseConversion,
    captureRequestContent: settings.captureRequestContent,
    hooks,
  })
  const { recordAttempt, recordAttemptContent } = attemptLogger

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

    if (context.signal.aborted || response.destroyed) {
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

    sendUpstreamRequest(parsed, options, upstreamRequestBody, {
      onResponse: upstreamRes => {
      const statusCode = upstreamRes.statusCode ?? 502
      const disposition = classifyUpstreamStatus(statusCode)

      // TTFT 由响应管线记录，Prompt Cache 仅从响应 usage 读取�?
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
          await recordAttemptContent({ attemptId: attempt?.id ?? null, captureStatus: 'captured', responseStatus: statusCode, upstreamResponseHeaders: upstreamRes.headers, clientResponseHeaders: null, responseBody: serializeCapturedBody(isStreaming, upstreamChunks, body), streaming: isStreaming })
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
              upstreamResponseHeaders: upstreamRes.headers,
              clientResponseHeaders: null,
              responseBody: serializeCapturedBody(isStreaming, upstreamChunks, errorResponse || null),
              streaming: isStreaming,
            })
            rejectAttempt(new RecordedAttemptError(err, {
              disposition: 'retry',
              statusCode,
              durationMilliseconds: Date.now() - attemptStartedAt,
              upstreamRequestId: upstreamRequestId,
              errorResponse: errorResponse || null,
              captureStatus: 'partial',
            }))
          })()
        })
        upstreamRes.resume()
        return
      }

      const idleTimeout = attachResponseIdleTimeout(upstreamRes, settings.idleTimeoutMilliseconds)

      // 转发响应�?
      if (!response.headersSent) {
        const downstreamHeaders = createDownstreamHeaders(upstreamRes.headers)
        if (adapter.requiresResponseConversion) {
          // 转换路径：响应体结构会变，移除上游长度限制头
          delete downstreamHeaders['content-length']
        }
        response.start(statusCode, downstreamHeaders)
      }

      const responsePipeline = new ResponsePipeline({
        adapter,
        isStreaming,
        captureEnabled: settings.captureRequestContent,
        response,
        upstreamHeaders: upstreamRes.headers,
        onUsage: () => undefined,
        onUpstreamChunk: () => undefined,
        onDownstreamChunk: () => undefined,
      })

      upstreamRes.on('data', chunk => {
        const chunkText = chunk.toString('utf8')

        // 记录 TTFT（第一个数据块到达时间�?
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
        await recordAttemptContent({ attemptId: attempt?.id ?? null, captureStatus: 'captured', responseStatus: statusCode, upstreamResponseHeaders: upstreamRes.headers, clientResponseHeaders: response.headers(), responseBody: pipelineResult.upstreamBody, convertedResponseBody: adapter.requiresResponseConversion ? pipelineResult.downstreamBody : null, streaming: isStreaming })
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
            upstreamResponseHeaders: upstreamRes.headers,
            clientResponseHeaders: response.headers(),
            responseBody: responsePipeline.partialBody(),
            streaming: isStreaming,
          })
          rejectAttempt(new RecordedAttemptError(err, {
            disposition,
            statusCode,
            durationMilliseconds: Date.now() - attemptStartedAt,
            upstreamRequestId: upstreamRequestId,
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
    const abortListener = () => onAbort()
    context.signal.addEventListener('abort', abortListener, { once: true })
    downstreamAbort = { dispose: () => context.signal.removeEventListener('abort', abortListener) }

  })
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
    // �?JSON 错误响应没有可提取的请求 ID�?
  }
  return null
}
