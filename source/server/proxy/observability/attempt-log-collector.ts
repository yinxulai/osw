import type { RequestStatus } from '@common/schemas'
import {
  createRequestAttempt,
  createRequestContent,
  createRequestConversion,
  replaceRequestUsage,
} from '@server/database/request-log-store'
import type { AttemptContentInput, AttemptLoggingInput, AttemptUsageInput, RequestLogger } from '@server/proxy/observability/logging-types'
import { redactHeaders } from '@server/proxy/response/headers'

export function createAttemptLogger(input: AttemptLoggingInput): Pick<RequestLogger, 'recordAttempt' | 'recordAttemptContent'> {
  const recordAttempt = async (status: RequestStatus, httpStatus: number | null, retryable: boolean, errorCode?: string, errorMessage?: string, upstreamRequestId?: string | null, usage?: AttemptUsageInput) => {
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
        upstreamProtocol: input.snapshot.upstreamProtocol,
        durationMilliseconds: Date.now() - input.startedAt,
      })
      const hasTokens = usage?.inputTokens != null && usage?.outputTokens != null
      await replaceRequestUsage({
        requestId: input.requestId,
        attemptId: attempt.id,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null,
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
          reasoningTokens: usage?.reasoningTokens ?? null,
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
