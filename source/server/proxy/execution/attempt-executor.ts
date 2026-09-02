import http from 'node:http'
import { URL } from 'node:url'
import { markProviderSuccess, markProviderFailure, markProviderModelSuccess, markProviderModelFailure } from '@server/proxy/upstream/health'
import { getSettings } from '@server/database/settings-store'
import { findConvertibleEndpoint, findEndpoint, type ModelWithProvider } from '@server/proxy/routing/router'
import type { Protocol, RawUsage } from '@common/schemas'
import { resolveUpstreamUrl } from '@server/proxy/request/request'
import { classifyHealthFailure, classifyUpstreamStatus } from '@server/proxy/response/response'
import type { HealthFailureScope } from '@server/proxy/response/response'
import { createAuthHeaders } from '@server/proxy/upstream/auth'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { isOutboundProxyConnectionError } from '@server/infrastructure/network/outbound-connector'
import { createDownstreamHeaders, createUpstreamRequestHeaders, redactHeaders } from '@server/proxy/response/headers'
import type { UpstreamStatusDisposition } from '@server/proxy/response/response'
import { attachResponseIdleTimeout, sendUpstreamRequest } from '@server/proxy/response/transport'
import { createRequestContext, type RequestContext } from '@server/proxy/request/request-context'
import { protocolAdapters } from '@server/proxy/protocols/registry'
import { ResponsePipeline } from '@server/proxy/response/response-pipeline'
import type { ProxyObservationHooks } from '@server/proxy/observability/hooks'
import type { AttemptFinalizationInput } from '@server/proxy/observability/logging-types'
import { runAttemptQueue } from '@server/proxy/execution/attempt-runner'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import { resolveAttemptSnapshot } from '@server/proxy/routing/routing'
import { listRulesForProviderModel } from '@server/database/request-rewrite-rule-store'
import { applyRequestRewriteRules, RequestRewriteError } from '@server/proxy/request-rewrite/request-rewrite-engine'
import { createAttemptLogger, initializeRequestLogger } from '@server/proxy/observability/logging'

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
  ttftMilliseconds?: number
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
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

function formatTarget(target: ModelWithProvider): string {
  return `${target.provider.name}/${target.model.modelName} [providerId=${target.provider.id}, providerModelId=${target.model.id}]`
}

async function recordHealthFailure(target: ModelWithProvider, statusCode: number | null, responseBody?: string | null): Promise<HealthFailureScope> {
  const scope = classifyHealthFailure(statusCode, responseBody)
  if (scope === 'provider') await markProviderFailure(target.provider.id)
  if (scope === 'provider-model') await markProviderModelFailure(target.model.id)
  return scope
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
    attributes: context.attributes,
    requestBody,
    captureRequestContent: settings.captureRequestContent,
  })
  console.debug(`[proxy] attempt queue started requestId=${requestId} targets=${targets.length} captureContent=${settings.captureRequestContent}`)
  await runAttemptQueue<ModelWithProvider, AttemptOutcome>({
    signal: context.signal,
    targets,
    attempt: (target, attemptIndex) => attemptRequest(context, response, target, attemptIndex, hooks),
    onSuccess: async (target, outcome, attemptIndex) => {
      if (outcome.disposition === 'success') {
        console.info(
          `[proxy] request forwarded requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} upstreamProtocol=${outcome.upstreamProtocol ?? protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
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
          reasoningTokens: outcome.reasoningTokens ?? null,
          promptCacheHit: outcome.promptCacheHit ?? null,
          rawUsage: outcome.rawUsage ?? null,
          upstreamProtocol: outcome.upstreamProtocol ?? null,
        })
        return
      }
    },
    onTerminal: async (target, outcome, attemptIndex) => {
      console.warn(
        `[proxy] upstream request terminated without retry requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
      )
      await requestLogger.finalizeRequestContent(outcome)
      await requestLogger.finalizeRequestLog('failed', startedAt)
    },
    onFailover: async (target, outcome, attemptIndex) => {
      const nextTarget = targets[attemptIndex + 1]
      const healthScope = await recordHealthFailure(target, outcome.statusCode, outcome.responseBody)
      console.warn(
        `[proxy] upstream failover scheduled requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms nextProviderModelId=${nextTarget?.model.id ?? 'none'} healthFailureScope=${healthScope}`,
      )
    },
    onError: async (target, err, attemptIndex) => {
      const lastError = err instanceof Error ? err : new Error(String(err))
      if (err instanceof RequestRewriteError) {
        console.warn(`[proxy] request rewrite rejected requestId=${requestId} providerModelId=${target.model.id} ruleId=${err.ruleId ?? 'unknown'} error=${err.message}`)
        if (!response.headersSent) response.fail(422, err.code, err.message)
        await requestLogger.finalizeRequestLog('failed', startedAt)
        return false
      }
      if (isClientRequestCancelled(err)) {
        console.debug(`[proxy] client request cancelled requestId=${requestId} attempt=${attemptIndex}`)
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
      const nextTarget = targets[attemptIndex + 1]
      console.warn(
        `[proxy] upstream attempt failed requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} failover=${!response.headersSent && nextTarget !== undefined} nextProviderModelId=${nextTarget?.model.id ?? 'none'} error=${lastError.message}`,
      )
      try {
        const snapshot = resolveAttemptSnapshot(target, protocol)
        if (!(err instanceof RecordedAttemptError)) {
          const attemptLogger = createAttemptLogger({
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
            captureRequestContent: settings.captureRequestContent,
            hooks: {},
          })
          const attempt = await attemptLogger.recordAttempt('failed', null, !response.headersSent, 'UPSTREAM_ERROR', lastError.message)
          await attemptLogger.recordAttemptContent({
            attemptId: attempt?.id ?? null,
            captureStatus: 'partial',
            responseStatus: null,
            upstreamResponseHeaders: null,
            clientResponseHeaders: null,
            responseBody: null,
          })
        }
      } catch (logError) {
        console.error(`[proxy] 写入请求尝试日志失败: ${(logError as Error).message}`)
      }
      const recordedOutcome = err instanceof RecordedAttemptError ? err.outcome : null
      let healthScope: HealthFailureScope = 'none'
      if (!isOutboundProxyConnectionError(err)) {
        healthScope = await recordHealthFailure(target, recordedOutcome?.statusCode ?? null, recordedOutcome?.responseBody)
      }
      if (healthScope !== 'none') {
        console.debug(
          `[proxy] health failure recorded requestId=${requestId} attempt=${attemptIndex} providerId=${target.provider.id} providerModelId=${target.model.id} scope=${healthScope} status=${recordedOutcome?.statusCode ?? 'none'}`,
        )
      }
      if (response.headersSent) {
        if (err instanceof RecordedAttemptError) await requestLogger.finalizeRequestContent(err.outcome)
        response.destroy(lastError)
        await requestLogger.finalizeRequestLog('failed', startedAt)
        return false
      }
      return true
    },
    onCancelled: async (_target, attemptIndex) => {
      console.debug(`[proxy] request execution cancelled requestId=${requestId} attempt=${attemptIndex} attempts=${attemptIndex + 1} totalDuration=${Date.now() - startedAt}ms`)
      await requestLogger.finalizeRequestLog('cancelled', startedAt)
    },
    onExhausted: async lastError => {
      if (!response.headersSent) {
        console.error(
          `[proxy] all providers failed requestId=${requestId} method=${context.method} path=${context.path} clientProtocol=${protocol} logicalModelId=${logicalModelId} attempts=${targets.length} totalDuration=${Date.now() - startedAt}ms error=${lastError?.message ?? 'unknown'}`,
        )
        const responseBody = response.fail(
          502,
          'ALL_PROVIDERS_FAILED',
          lastError?.message ?? '所有 Provider 都失败了',
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
  if (!endpoint) throw new Error(`模型 ${model.modelName} 不支持协议 ${protocol}`)
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
  console.debug(`[proxy] attempt prepared requestId=${requestId} attempt=${attemptIndex} providerId=${provider.id} providerModelId=${model.id} clientProtocol=${protocol} upstreamProtocol=${endpointProtocol} conversion=${adapter.kind === 'conversion'} requestBytes=${requestBody.length} upstreamRequestBytes=${upstreamRequestBody.length} timeout=${provider.timeoutMilliseconds}ms`)
  const apiKey = await getSecretStore().get(provider.apiKeyReference)

  const isHttps = parsed.protocol === 'https:'

  const headers = createUpstreamRequestHeaders(
    context.headers,
    createAuthHeaders(endpointProtocol, apiKey, endpoint.customAuthHeader),
    upstreamRequestBody.length,
  )
  const rules = await listRulesForProviderModel(model.id)
  const modified = applyRequestRewriteRules(upstreamRequestBody, headers, rules, { stage: 'request', clientProtocol: protocol, upstreamProtocol: endpointProtocol })
  console.debug(`[proxy] request rewrite evaluated requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} rules=${rules.length} applied=${modified.appliedRuleIds.length} skipped=${modified.skippedRuleIds.length} appliedRuleIds=${modified.appliedRuleIds.join(',') || 'none'} bodyBytesBefore=${upstreamRequestBody.length} bodyBytesAfter=${modified.body.length}`)

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: context.method,
    headers: modified.headers,
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
    upstreamRequestHeaders: modified.headers,
    upstreamRequestBody: modified.body,
    requestRewriteRuleIds: modified.appliedRuleIds,
    customAuthHeader: endpoint.customAuthHeader,
    clientProtocol: protocol,
    upstreamProtocol: endpointProtocol,
    requiresResponseConversion: adapter.kind === 'conversion',
    captureRequestContent: settings.captureRequestContent,
    hooks,
  })
  const finalizeAttempt = async (input: AttemptFinalizationInput) => {
    const attempt = await attemptLogger.recordAttempt(
      input.status,
      input.httpStatus,
      input.retryable,
      input.errorCode,
      input.errorMessage,
      input.upstreamRequestId,
      input.usage,
    )
    await attemptLogger.recordAttemptContent({
      attemptId: attempt?.id ?? null,
      captureStatus: input.content?.captureStatus ?? 'captured',
      responseStatus: input.content?.responseStatus ?? null,
      upstreamResponseHeaders: input.content?.upstreamResponseHeaders ?? null,
      clientResponseHeaders: input.content?.clientResponseHeaders ?? null,
      responseBody: input.content?.responseBody ?? null,
      convertedResponseBody: input.content?.convertedResponseBody,
      streaming: input.content?.streaming,
    })
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

    sendUpstreamRequest(parsed, options, modified.body, {
      onResponse: upstreamRes => {
      const statusCode = upstreamRes.statusCode ?? 502
      const disposition = classifyUpstreamStatus(statusCode)

      // TTFT 由响应管线记录，Prompt Cache 仅从响应 usage 读取。
      let ttftMilliseconds: number | undefined
      let responseBody = ''
      const upstreamChunks: string[] = []
      const upstreamRequestId = extractUpstreamRequestId(upstreamRes.headers)

      const contentType = String(upstreamRes.headers['content-type'] ?? '')
      const isStreaming = isStreamingRequest(requestBody) && contentType.includes('text/event-stream')
      console.debug(`[proxy] upstream response received requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} status=${statusCode} disposition=${disposition} streaming=${isStreaming} upstreamRequestIdPresent=${upstreamRequestId !== null} responseLatency=${Date.now() - attemptStartedAt}ms`)

      if (disposition === 'failover') {
        const idleTimeout = attachResponseIdleTimeout(upstreamRes, settings.idleTimeoutMilliseconds)
        upstreamRes.on('data', chunk => {
          const chunkText = chunk.toString('utf8')
          if (settings.captureRequestContent) upstreamChunks.push(chunkText)
          responseBody += chunkText
        })
        upstreamRes.on('end', async () => {
          idleTimeout.dispose()
          const body = responseBody || null
          const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(body)
          await finalizeAttempt({
            status: 'failed',
            httpStatus: statusCode,
            retryable: true,
            errorCode: `Status_${statusCode}`,
            errorMessage: `上游返回 ${statusCode}`,
            upstreamRequestId: resolvedRequestId,
            content: {
              captureStatus: 'captured',
              responseStatus: statusCode,
              upstreamResponseHeaders: upstreamRes.headers,
              clientResponseHeaders: null,
              responseBody: serializeCapturedBody(isStreaming, upstreamChunks, body),
              streaming: isStreaming,
            },
          })
          resolveAttempt({ disposition: 'failover', statusCode, durationMilliseconds: Date.now() - attemptStartedAt, upstreamRequestId: resolvedRequestId, responseBody: body, responseStatus: statusCode, captureStatus: 'captured' })
        })
        upstreamRes.on('error', err => {
          idleTimeout.dispose()
          if (settled) return
          void (async () => {
            await finalizeAttempt({
              status: 'failed',
              httpStatus: statusCode,
              retryable: true,
              errorCode: 'UPSTREAM_STREAM_ERROR',
              errorMessage: err.message,
              upstreamRequestId,
              content: {
                captureStatus: 'partial',
                responseStatus: statusCode,
                upstreamResponseHeaders: upstreamRes.headers,
                clientResponseHeaders: null,
                responseBody: serializeCapturedBody(isStreaming, upstreamChunks, responseBody || null),
                streaming: isStreaming,
              },
            })
            rejectAttempt(new RecordedAttemptError(err, {
              disposition: 'failover',
              statusCode,
              durationMilliseconds: Date.now() - attemptStartedAt,
              upstreamRequestId: upstreamRequestId,
              responseBody: serializeCapturedBody(isStreaming, upstreamChunks, responseBody || null),
              responseStatus: statusCode,
              captureStatus: 'partial',
            }))
          })()
        })
        upstreamRes.resume()
        return
      }

      const idleTimeout = attachResponseIdleTimeout(upstreamRes, settings.idleTimeoutMilliseconds)

      const downstreamHeaders = createDownstreamHeaders(upstreamRes.headers)
      if (adapter.kind === 'conversion' || !isStreaming) delete downstreamHeaders['content-length']
      if (isStreaming && !response.headersSent) response.start(statusCode, downstreamHeaders)
      let responseRewriteAppliedRuleIds: string[] = []
      let responseRewriteSkippedRuleIds: string[] = []

      const responsePipeline = new ResponsePipeline({
        adapter,
        isStreaming,
        captureEnabled: settings.captureRequestContent,
        onFirstOutput: () => {
          if (isStreaming && ttftMilliseconds === undefined) {
            ttftMilliseconds = Date.now() - attemptStartedAt
          }
        },
        response,
        upstreamHeaders: downstreamHeaders,
        onStart: headers => { if (!response.headersSent) response.start(statusCode, headers) },
        transformResponse: !isStreaming ? (body, headers) => {
          const modifiedResponse = applyRequestRewriteRules(body, headers, rules, {
            stage: 'response',
            clientProtocol: protocol,
            upstreamProtocol: endpointProtocol,
            streaming: false,
          })
          responseRewriteAppliedRuleIds = modifiedResponse.appliedRuleIds
          responseRewriteSkippedRuleIds = modifiedResponse.skippedRuleIds
          return { body: modifiedResponse.body, headers: modifiedResponse.headers }
        } : undefined,
        onConversionError: error => {
          console.warn(`[proxy] response conversion failed requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} clientProtocol=${protocol} upstreamProtocol=${endpointProtocol} streaming=${isStreaming} error=${error.message}`)
        },
        onUsage: () => undefined,
        onUpstreamChunk: () => undefined,
        onDownstreamChunk: () => undefined,
      })

      upstreamRes.on('data', chunk => {
        const chunkText = chunk.toString('utf8')
        if (disposition !== 'success') {
          responseBody += chunkText
        }
        responsePipeline.push(chunkText, disposition === 'success')
      })

      upstreamRes.on('end', async () => {
        idleTimeout.dispose()

        const pipelineResult = responsePipeline.finish(disposition === 'success', disposition === 'success' ? null : (responseBody || null))
        console.debug(`[proxy] response rewrite evaluated requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} streaming=${isStreaming} skippedForStreaming=${isStreaming} rules=${rules.length} applied=${responseRewriteAppliedRuleIds.length} skipped=${isStreaming ? rules.length : responseRewriteSkippedRuleIds.length} appliedRuleIds=${responseRewriteAppliedRuleIds.join(',') || 'none'}`)
        const resolvedBody = disposition === 'success' ? pipelineResult.upstreamBody : (responseBody || null)
        const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(resolvedBody)
        await finalizeAttempt({
          status: disposition === 'success' ? 'success' : 'failed',
          httpStatus: statusCode,
          retryable: false,
          errorCode: disposition === 'success' ? undefined : `Status_${statusCode}`,
          errorMessage: disposition === 'success' ? undefined : `上游返回 ${statusCode}`,
          upstreamRequestId: resolvedRequestId,
          usage: pipelineResult.usage,
          content: {
            captureStatus: 'captured',
            responseStatus: statusCode,
            upstreamResponseHeaders: upstreamRes.headers,
            clientResponseHeaders: response.headers(),
            responseBody: pipelineResult.upstreamBody,
            convertedResponseBody: adapter.kind === 'conversion' ? pipelineResult.downstreamBody : null,
            streaming: isStreaming,
          },
        })
        resolveAttempt({
          disposition,
          statusCode,
          durationMilliseconds: Date.now() - attemptStartedAt,
          upstreamRequestId: resolvedRequestId,
          ttftMilliseconds,
          ...pipelineResult.usage,
          promptCacheHit: pipelineResult.usage.cachedInputTokens == null ? null : pipelineResult.usage.cachedInputTokens > 0,
          upstreamProtocol: adapter.kind === 'conversion' ? endpointProtocol : null,
          responseStatus: statusCode,
          responseHeaders: JSON.stringify(redactHeaders(createDownstreamHeaders(upstreamRes.headers))),
          responseBody: disposition === 'success' ? pipelineResult.downstreamBody : resolvedBody,
          captureStatus: 'captured',
        })
      })

      upstreamRes.on('error', err => {
        idleTimeout.dispose()
        if (settled) return
        void (async () => {
          await finalizeAttempt({
            status: 'failed',
            httpStatus: statusCode,
            retryable: false,
            errorCode: 'UPSTREAM_STREAM_ERROR',
            errorMessage: err.message,
            upstreamRequestId,
            usage: responsePipeline.getUsage(),
            content: {
              captureStatus: 'partial',
              responseStatus: statusCode,
              upstreamResponseHeaders: upstreamRes.headers,
              clientResponseHeaders: response.headers(),
              responseBody: responsePipeline.partialBody(),
              streaming: isStreaming,
            },
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

function isStreamingRequest(requestBody: Buffer): boolean {
  try {
    const payload = JSON.parse(requestBody.toString('utf8')) as Record<string, unknown>
    return payload !== null && !Array.isArray(payload) && typeof payload === 'object' && payload.stream === true
  } catch {
    return false
  }
}

function serializeStreamingChunks(chunks: string[]): string {
  return JSON.stringify({ schemaVersion: 1, chunks })
}

function serializeCapturedBody(isStreaming: boolean, chunks: string[], body: string | null): string | null {
  return isStreaming ? serializeStreamingChunks(chunks) : body
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

export function extractRequestIdFromBody(body: string | null): string | null {
  if (!body) return null

  // 普�?JSON 响应：兼容成功响应、错误响应以�?Provider 自己的嵌套结构�?
  const directId = parseRequestIdJson(body)
  if (directId) return directId

  // 流式响应的捕获内容是 { schemaVersion, chunks }，每�?chunk 可能包含多个 SSE event�?
  try {
    const captured = JSON.parse(body) as Record<string, unknown>
    if (Array.isArray(captured.chunks)) {
      for (const chunk of captured.chunks) {
        if (typeof chunk !== 'string') continue
        const id = extractRequestIdFromSse(chunk)
        if (id) return id
      }
    }
  } catch {
    // �?JSON body 可能仍然是原�?SSE 文本，继续按 SSE 解析�?
  }

  return extractRequestIdFromSse(body)
}

function parseRequestIdJson(body: string): string | null {
  try {
    return findRequestId(JSON.parse(body))
  } catch {
    return null
  }
}

export function extractRequestIdFromSse(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const data = line.trim().replace(/^data:\s*/, '')
    if (!data || data === '[DONE]') continue
    const id = parseRequestIdJson(data)
    if (id) return id
  }
  return null
}

function findRequestId(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findRequestId(item, depth + 1)
      if (id) return id
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of ['request_id', 'requestId', 'id']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const child of Object.values(record)) {
    const id = findRequestId(child, depth + 1)
    if (id) return id
  }
  return null
}
