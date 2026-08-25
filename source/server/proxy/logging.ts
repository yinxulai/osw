import type http from 'node:http'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { Protocol, RawUsage, RequestStatus } from '@common/schemas'
import { getSettings } from '../database/settings-store'
import {
  createRequestAttempt,
  createRequestContent,
  createRequestConversion,
  createRequestLog,
  pruneRequestLogs,
  replaceRequestUsage,
  updateRequestContent,
  updateRequestLogStatus,
} from '../database/request-log-store'
import { redactHeaders } from './headers'
import type { ProxyObservationHooks } from './hooks'

export interface RequestLoggingInput {
  requestId: string
  logicalModelId: string
  clientProtocol: Protocol
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  requestBody: Buffer
  captureRequestContent: boolean
}

export interface RequestLogMetrics {
  ttftMilliseconds?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  promptCacheHit?: boolean | null
  rawUsage?: RawUsage | null
  upstreamProtocol?: Protocol | null
}

export interface RequestLogOutcome {
  statusCode: number
  captureStatus?: 'captured' | 'partial'
  responseStatus?: number
  responseHeaders?: string
  responseBody?: string | null
}

export interface AttemptLogSnapshot {
  providerId: string
  providerModelId: string
  providerName: string
  providerModelName: string
  upstreamProtocol: Protocol
  url: string
}

export interface AttemptUsageInput {
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  rawUsage?: RawUsage | null
}

export interface AttemptContentInput {
  attemptId: string | null
  captureStatus: 'captured' | 'partial'
  responseStatus: number | null
  upstreamResponseHeaders: IncomingHttpHeaders | null
  clientResponseHeaders: IncomingHttpHeaders | OutgoingHttpHeaders | null
  responseBody: string | null
  convertedResponseBody?: string | null
  streaming?: boolean
}

export interface AttemptLoggingInput {
  requestId: string
  attemptIndex: number
  startedAt: number
  snapshot: AttemptLogSnapshot
  method: string
  path: string
  requestHeaders: http.IncomingHttpHeaders
  requestBody: Buffer
  upstreamRequestHeaders: http.OutgoingHttpHeaders
  upstreamRequestBody: Buffer
  requestRewriteRuleIds?: string[]
  customAuthHeader?: string | null
  clientProtocol: Protocol
  upstreamProtocol: Protocol
  requiresResponseConversion: boolean
  captureRequestContent: boolean
  hooks: ProxyObservationHooks
}

export interface RequestLogger {
  readonly requestContentId: string | null
  finalizeRequestLog(status: RequestStatus, startedAt: number, metrics?: RequestLogMetrics): Promise<void>
  finalizeRequestContent(outcome: RequestLogOutcome): Promise<void>
  finalizeLocalErrorContent(statusCode: number, responseHeaders: IncomingHttpHeaders | OutgoingHttpHeaders, responseBody: string): Promise<void>
  recordAttempt(status: RequestStatus, httpStatus: number | null, retryable: boolean, errorCode?: string, errorMessage?: string, upstreamRequestId?: string | null, details?: string | null, usage?: AttemptUsageInput): Promise<{ id: string } | null>
  recordAttemptContent(input: AttemptContentInput): Promise<void>
}

export async function initializeRequestLogger(input: RequestLoggingInput): Promise<RequestLogger> {
  let requestContentId: string | null = null
  try {
    await createRequestLog({
      id: input.requestId,
      logicalModelId: input.logicalModelId,
      clientProtocol: input.clientProtocol,
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
    if (input.captureRequestContent) {
      const content = await createRequestContent({
        requestId: input.requestId,
        attemptId: null,
        captureStatus: 'partial',
        requestMethod: input.method,
        requestPath: input.path,
        requestHeaders: JSON.stringify(redactHeaders(input.headers)),
        requestBody: input.requestBody.toString('utf8'),
        responseStatus: null,
        responseHeaders: null,
        responseBody: null,
      })
      requestContentId = content.id
    }
  } catch (error) {
    console.error(`[proxy] 写入请求日志失败: ${(error as Error).message}`)
  }

  return createRequestLogger(requestContentId, input)
}

function createRequestLogger(requestContentId: string | null, input: RequestLoggingInput): RequestLogger {
  const finalizeRequestLog = async (status: RequestStatus, startedAt: number, metrics?: RequestLogMetrics) => {
    try {
      const totalDuration = Date.now() - startedAt
      const hasTokens = metrics?.inputTokens != null && metrics?.outputTokens != null
      await updateRequestLogStatus(input.requestId, {
        status,
        totalDurationMilliseconds: totalDuration,
        ...(metrics ? {
          totalTokens: hasTokens ? metrics.inputTokens! + metrics.outputTokens! : null,
          inputTokens: metrics.inputTokens ?? null,
          outputTokens: metrics.outputTokens ?? null,
          cachedInputTokens: metrics.cachedInputTokens ?? null,
          cacheCreationInputTokens: metrics.cacheCreationInputTokens ?? null,
          promptCacheHit: metrics.promptCacheHit ?? null,
          rawUsage: metrics.rawUsage ?? null,
          ttftMilliseconds: metrics.ttftMilliseconds ?? null,
          upstreamProtocol: metrics.upstreamProtocol ?? null,
        } : {}),
      })
      const settings = await getSettings()
      await pruneRequestLogs(settings.logRetentionDays)
    } catch (error) {
      console.error(`[proxy] 更新请求日志失败: ${(error as Error).message}`)
    }
  }

  const finalizeRequestContent = async (outcome: RequestLogOutcome) => {
    if (!requestContentId) return
    try {
      await updateRequestContent(requestContentId, {
        captureStatus: outcome.captureStatus ?? 'captured',
        responseStatus: outcome.responseStatus ?? outcome.statusCode,
        responseHeaders: outcome.responseHeaders ?? null,
        responseBody: outcome.responseBody ?? null,
      })
    } catch (error) {
      console.error(`[proxy] 更新请求正文失败: ${(error as Error).message}`)
    }
  }

  const finalizeLocalErrorContent = async (statusCode: number, responseHeaders: IncomingHttpHeaders | OutgoingHttpHeaders, responseBody: string) => {
    await finalizeRequestContent({
      statusCode,
      captureStatus: 'captured',
      responseHeaders: JSON.stringify(redactHeaders(responseHeaders)),
      responseBody,
    })
  }

  return {
    requestContentId,
    finalizeRequestLog,
    finalizeRequestContent,
    finalizeLocalErrorContent,
    recordAttempt: async () => null,
    recordAttemptContent: async () => undefined,
  }
}

export function createAttemptLogger(input: AttemptLoggingInput): Pick<RequestLogger, 'recordAttempt' | 'recordAttemptContent'> {
  const recordAttempt = async (status: RequestStatus, httpStatus: number | null, retryable: boolean, errorCode?: string, errorMessage?: string, upstreamRequestId?: string | null, details?: string | null, usage?: AttemptUsageInput) => {
    try {
      const attempt = await createRequestAttempt({
        requestId: input.requestId,
        ...input.snapshot,
        attemptIndex: input.attemptIndex,
        status,
        httpStatus,
        retryable,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        upstreamRequestId: upstreamRequestId ?? null,
        details: details ?? null,
        upstreamProtocol: input.snapshot.upstreamProtocol,
        durationMilliseconds: Date.now() - input.startedAt,
      })
      const hasTokens = usage?.inputTokens != null && usage?.outputTokens != null
      await replaceRequestUsage({
        requestId: input.requestId,
        attemptId: attempt.id,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: hasTokens ? usage!.inputTokens! + usage!.outputTokens! : null,
        cachedInputTokens: usage?.cachedInputTokens ?? null,
        cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
        rawUsage: usage?.rawUsage ?? null,
      })
      await input.hooks.onAttemptRecorded?.({
        requestId: input.requestId,
        attemptIndex: input.attemptIndex,
        status,
        httpStatus,
        retryable,
        providerId: input.snapshot.providerId,
        providerModelId: input.snapshot.providerModelId,
        upstreamProtocol: input.snapshot.upstreamProtocol,
        durationMilliseconds: Date.now() - input.startedAt,
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

  const recordAttemptContent = async (content: AttemptContentInput) => {
    if (!input.captureRequestContent || !content.attemptId) return
    try {
      await createRequestContent({
        requestId: input.requestId,
        attemptId: content.attemptId,
        captureStatus: content.captureStatus,
        requestMethod: input.method,
        requestPath: input.path,
        requestHeaders: JSON.stringify(redactHeaders(input.upstreamRequestHeaders, input.customAuthHeader ? [input.customAuthHeader] : [])),
        requestBody: input.upstreamRequestBody.toString('utf8'),
        requestRewriteRuleIds: input.requestRewriteRuleIds ?? [],
        responseStatus: content.responseStatus,
        responseHeaders: content.clientResponseHeaders ? JSON.stringify(redactHeaders(content.clientResponseHeaders)) : null,
        responseBody: content.responseBody,
      })
      if (input.requiresResponseConversion && content.attemptId) {
        await createRequestConversion({
          requestId: input.requestId,
          attemptId: content.attemptId,
          clientProtocol: input.clientProtocol,
          upstreamProtocol: input.upstreamProtocol,
          clientRequestHeaders: JSON.stringify(redactHeaders(input.requestHeaders)),
          upstreamRequestHeaders: JSON.stringify(redactHeaders(input.upstreamRequestHeaders, input.customAuthHeader ? [input.customAuthHeader] : [])),
          upstreamResponseHeaders: content.upstreamResponseHeaders ? JSON.stringify(redactHeaders(content.upstreamResponseHeaders)) : null,
          clientResponseHeaders: content.clientResponseHeaders ? JSON.stringify(redactHeaders(content.clientResponseHeaders)) : null,
          requestBody: input.upstreamRequestBody.toString('utf8'),
          responseBody: content.convertedResponseBody ?? null,
          streaming: content.streaming ?? false,
          durationMilliseconds: Date.now() - input.startedAt,
        })
      }
      await input.hooks.onContentCaptured?.({
        requestId: input.requestId,
        attemptId: content.attemptId,
        captureStatus: content.captureStatus,
        responseStatus: content.responseStatus ?? null,
        responseBody: content.responseBody ?? null,
      })
    } catch (error) {
      console.error(`[proxy] 写入请求正文失败: ${(error as Error).message}`)
    }
  }

  return { recordAttempt, recordAttemptContent }
}
