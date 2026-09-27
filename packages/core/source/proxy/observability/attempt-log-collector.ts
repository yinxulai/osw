import {
  createAttemptContent,
  createRequestAttempt,
  recordAttemptUsage,
} from '@server/database/request-log-store'
import type { AttemptFinalizationInput, AttemptLogSnapshot, AttemptLogger, AttemptLoggingInput, UpstreamContentInput } from '@server/proxy/observability/logging-types'
import type { UpstreamTarget } from '@server/proxy/contracts'
import { redactHeaders, serializeCapturedHeaders } from '@server/proxy/response/headers'

/** 从规划结果里挑出要落库的上游事实。字段名不一样（`protocol` / `upstreamProtocol`）是故意的：显式投影而不是整体透传。 */
function toAttemptSnapshot(target: UpstreamTarget): AttemptLogSnapshot {
  return {
    providerId: target.providerId,
    providerModelId: target.providerModelId,
    providerName: target.providerName,
    providerModelName: target.providerModelName,
    upstreamProtocol: target.protocol,
    url: target.url,
  }
}

/**
 * 尝试级日志器。
 *
 * 一次尝试的全部事实（状态、耗时、TTFT、流式、命中的改写规则、用量、
 * 原始 usage）都在 {@link AttemptLogger.finalizeAttempt} 里一次性写入
 * `request_attempts`；只有「上游视角正文」受 `captureRequestContent`
 * 开关控制。这样即使正文采集关掉，事实依然完整可查。
 */
export function createAttemptLogger(input: AttemptLoggingInput): AttemptLogger {
  /**
   * 写入上游视角的正文记录。列名不带 `upstream` 前缀——表本身就代表上游视角。
   */
  const recordUpstreamContent = async (attemptId: string, content: UpstreamContentInput) => {
    if (!input.captureRequestContent) return
    try {
      await createAttemptContent({
        attemptId,
        captureStatus: content.captureStatus,
        requestHeaders: JSON.stringify(redactHeaders(input.upstreamRequestHeaders, input.customAuthHeader ? [input.customAuthHeader] : [])),
        requestBody: input.upstreamRequestBody.toString('utf8'),
        responseStatus: content.responseStatus,
        responseHeaders: serializeCapturedHeaders(content.responseHeaders),
        responseBody: content.responseBody,
      })
    } catch (error) {
      console.error(`[proxy] failed to write the request body: ${(error as Error).message}`)
    }
  }

  /**
   * 一次性写入尝试记录与上游视角正文。
   *
   * 正文写入依赖 attemptId，因此必须等待尝试落库成功后再写。
   */
  const finalizeAttempt = async (finalization: AttemptFinalizationInput) => {
    try {
      const usage = finalization.usage
      const attempt = await createRequestAttempt({
        requestId: input.requestId,
        ...toAttemptSnapshot(input.target),
        attemptIndex: input.attemptIndex,
        status: finalization.status,
        httpStatus: finalization.httpStatus,
        retryable: finalization.retryable,
        upstreamTransport: finalization.upstreamTransport,
        errorCode: finalization.errorCode ?? null,
        errorMessage: finalization.errorMessage ?? null,
        upstreamRequestId: finalization.upstreamRequestId ?? null,
        upstreamProtocol: input.target.protocol,
        durationMilliseconds: Date.now() - input.startedAt,
        ttftMilliseconds: finalization.ttftMilliseconds ?? null,
        requestRewriteRuleIds: input.requestRewriteRuleIds ?? [],
        responseRewriteRuleIds: finalization.responseRewriteRuleIds ?? [],
      })
      // 这次尝试已经落库：后到的是更弱的事实（取消），不能覆盖已落库的用量与正文。
      if (!attempt) {
        console.debug(`[proxy] attempt record already exists, skipping duplicate write requestId=${input.requestId} attemptIndex=${input.attemptIndex}`)
        return
      }
      await recordAttemptUsage({
        attemptId: attempt.id,
        servesRequest: finalization.servesRequest,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null,
        cachedInputTokens: usage?.cachedInputTokens ?? null,
        cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
        rawUsage: usage?.rawUsage ?? null,
      })
      if (finalization.upstreamContent) await recordUpstreamContent(attempt.id, finalization.upstreamContent)
    } catch (error) {
      console.error(`[proxy] failed to write the request attempt log: ${(error as Error).message}`)
    }
  }

  return { finalizeAttempt }
}
