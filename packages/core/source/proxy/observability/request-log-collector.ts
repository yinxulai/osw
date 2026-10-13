import type { RequestStatus } from '@common/schemas'
import type { ClientDelivery } from '@server/proxy/contracts'
import { getSettings } from '@server/database/settings-store'
import {
  createRequestContent,
  createRequestLog,
  pruneRequestContents,
  pruneRequestLogs,
  updateRequestContent,
  updateRequestLogContext,
  updateRequestLogStatus,
} from '@server/database/request-log-store'
import { serializeCapturedHeaders } from '@server/proxy/response/headers'
import type { RequestContentOutcome, RequestLogger, RequestLogContext, RequestLoggingInput } from '@server/proxy/observability/logging-types'

/**
 * 过期清理的节流间隔。
 *
 * 保留期清理是维护动作，没必要每个请求都扫一遍全表；一分钟一次已经足够及时。
 */
const PRUNE_INTERVAL_MS = 60_000
let lastPruneTime = 0

/**
 * 请求记录与正文各自按自己的保留窗口清理。
 *
 * 两条窗口是独立设置：可能「请求永久保留、正文只留 7 天」，也可能反过来。
 * 取值为 0 的那一项表示永久保留，跳过即可——清理函数自己也会把 `< 1` 当作不做。
 */
async function pruneRequestLogsThrottled(): Promise<void> {
  const time = Date.now()
  if (time - lastPruneTime < PRUNE_INTERVAL_MS) return
  lastPruneTime = time
  const settings = await getSettings()
  await pruneRequestLogs(settings.requestLogRetentionDays)
  await pruneRequestContents(settings.contentRetentionDays)
}

/**
 * 关掉「记录请求日志」时用的空日志器。
 *
 * 返回它而不是 `null`：调用方（收尾、拒绝、中断三条路径）不必各自分支，
 * 「不记录」就是一组什么都不做的实现。
 */
const NOOP_REQUEST_LOGGER: RequestLogger = {
  requestContentId: null,
  updateRequest: async () => {},
  finalizeRequestLog: async () => {},
  finalizeRequestContent: async () => {},
  finalizeLocalErrorContent: async () => {},
}

export async function initializeRequestLogger(input: RequestLoggingInput): Promise<RequestLogger> {
  // 请求行是日志的根：没有它，尝试行、用量、正文都无处归属，索性整条链路都不写。
  if (!input.captureRequestLogs) return NOOP_REQUEST_LOGGER

  let requestContentId: string | null = null
  try {
    await createRequestLog({
      id: input.requestId,
      apiKeyId: input.apiKeyId,
      logicalModelId: input.logicalModelId,
      clientProtocol: input.clientProtocol,
      // 传输形态是客户端声明的预期，原样落库；上游跳是否同形是尝试行的事。
      transport: input.transport,
      status: 'pending',
      totalDurationMilliseconds: 0,
      attributes: input.attributes,
    })
    if (input.captureRequestContent) {
      const content = await createRequestContent({
        requestId: input.requestId,
        captureStatus: 'partial',
        requestMethod: input.method,
        requestPath: input.path,
        requestHeaders: serializeCapturedHeaders(input.headers),
        requestBody: input.requestBody.toString('utf8'),
      })
      requestContentId = content.id
    }
  } catch (error) {
    console.error(`[proxy] failed to write the request log: ${(error as Error).message}`)
  }

  return createRequestLogger(requestContentId, input)
}

function createRequestLogger(requestContentId: string | null, input: RequestLoggingInput): RequestLogger {
  /** 已经收尾过：取消竞态下两条路径会先后调用同一个 logger。 */
  let finalized = false

  const updateRequest = async (context: RequestLogContext) => {
    input.logicalModelId = context.logicalModelId
    input.apiKeyId = context.apiKeyId
    input.clientProtocol = context.clientProtocol
    input.transport = context.transport
    input.method = context.method
    input.path = context.path
    input.headers = context.headers
    input.requestBody = context.requestBody
    try {
      await updateRequestLogContext(input.requestId, {
        apiKeyId: context.apiKeyId,
        logicalModelId: context.logicalModelId,
        clientProtocol: context.clientProtocol,
        transport: context.transport,
      })
      if (requestContentId) {
        await updateRequestContent(requestContentId, {
          requestMethod: context.method,
          requestPath: context.path,
          requestHeaders: serializeCapturedHeaders(context.headers),
          requestBody: context.requestBody.toString('utf8'),
        })
      }
    } catch (error) {
      console.error(`[proxy] failed to update the request log: ${(error as Error).message}`)
    }
  }

  const finalizeRequestLog = async (status: RequestStatus, startedAt: number) => {
    // 后到的收尾是重复的事实，不是新的事实：不重写状态，也不重复触发清理。
    if (finalized) return
    finalized = true
    try {
      await updateRequestLogStatus(input.requestId, {
        status,
        totalDurationMilliseconds: Date.now() - startedAt,
      })
      await pruneRequestLogsThrottled()
    } catch (error) {
      console.error(`[proxy] failed to update the request log: ${(error as Error).message}`)
    }
  }

  /**
   * 写入客户端视角的最终响应。列名不带 `client` 前缀——表本身就代表客户端视角。
   */
  const finalizeRequestContent = async (outcome: RequestContentOutcome) => {
    if (!requestContentId) return
    try {
      await updateRequestContent(requestContentId, {
        captureStatus: outcome.captureStatus ?? 'captured',
        responseStatus: outcome.statusCode,
        responseHeaders: outcome.responseHeaders ?? null,
        responseBody: outcome.responseBody ?? null,
      })
    } catch (error) {
      console.error(`[proxy] failed to update the request body: ${(error as Error).message}`)
    }
  }

  const finalizeLocalErrorContent = async (delivered: ClientDelivery) => {
    await finalizeRequestContent({
      perspective: 'client',
      statusCode: delivered.statusCode,
      // 代理自己生成的错误响应必定是完整的一份：它在本进程里一次成形，
      // 因此不受 `delivered.complete` 影响。
      captureStatus: 'captured',
      responseHeaders: serializeCapturedHeaders(delivered.headers),
      responseBody: delivered.body,
    })
  }

  return {
    requestContentId,
    updateRequest,
    finalizeRequestLog,
    finalizeRequestContent,
    finalizeLocalErrorContent,
  }
}
