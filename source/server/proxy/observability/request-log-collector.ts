import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { RequestStatus } from '@common/schemas'
import { getSettings } from '@server/database/settings-store'
import {
  createRequestContent,
  createRequestLog,
  pruneRequestLogs,
  updateRequestContent,
  updateRequestLogStatus,
} from '@server/database/request-log-store'
import { redactHeaders } from '@server/proxy/response/headers'
import type { RequestLogMetrics, RequestLogOutcome, RequestLogger, RequestLoggingInput } from '@server/proxy/observability/logging-types'

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
      reasoningTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      promptCacheHit: null,
      rawUsage: null,
      ttftMilliseconds: null,
      cacheHit: null,
      attributes: input.attributes,
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
          reasoningTokens: metrics.reasoningTokens ?? null,
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
