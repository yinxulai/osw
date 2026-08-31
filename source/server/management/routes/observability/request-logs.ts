import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import type { RequestLog, RequestLogEntry } from '@common/schemas'
import { countRequestLogs, getRequestLog, listAttemptsByRequest, listRequestContents, listRequestConversions, listRequestLogs, pruneRequestLogsBefore } from '@server/database/request-log-store'
import { listRequestRewriteRulesByIds } from '@server/database/request-rewrite-rule-store'
import { HttpRouter } from '@server/http-router'

export const requestLogRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/request-log/list', handleListRequestLogs)
  .post('/api/request-log/detail', handleRequestLogDetail)
  .post('/api/request-log/prune', handlePruneRequestLogs)

const ListRequestLogsSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  providerId: z.string().optional(),
  providerModelId: z.string().optional(),
  logicalModelId: z.string().optional(),
  clientProtocol: z.string().optional(),
  status: z.enum(['pending', 'success', 'failed', 'cancelled']).optional(),
  createdTimeFrom: z.number().int().nonnegative().optional(),
  createdTimeTo: z.number().int().nonnegative().optional(),
})

const PruneRequestLogsSchema = z.object({ retentionDays: z.number().int().positive() })
const RequestLogDetailSchema = z.object({ id: z.string().trim().min(1) })

async function handleRequestLogDetail(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = RequestLogDetailSchema.parse(body ?? {})
  const log = await getRequestLog(id)
  if (!log) {
    sendError(res, 'RESOURCE_NOT_FOUND', `请求日志不存在 ${id}`, 404)
    return
  }
  const [entry, contents, conversions] = await Promise.all([
    mapRequestLogEntry(log),
    listRequestContents(id),
    listRequestConversions(id),
  ])
  const ruleIds = [...new Set(contents.flatMap(content => content.requestRewriteRuleIds))]
  const requestRewriteRules = (await listRequestRewriteRulesByIds(ruleIds)).map(rule => ({ id: rule.id, name: rule.name }))
  sendSuccess(res, { ...entry, contents, conversions, requestRewriteRules })
}

async function handlePruneRequestLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { retentionDays } = PruneRequestLogsSchema.parse(body ?? {})
  const deleted = await pruneRequestLogsBefore(retentionDays)
  sendSuccess(res, { deleted })
}

async function handleListRequestLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { limit, offset, providerId, providerModelId, logicalModelId, clientProtocol, status, createdTimeFrom, createdTimeTo } = ListRequestLogsSchema.parse(body ?? {})
  const pageSize = limit ?? 50
  const filter = { providerId, providerModelId, logicalModelId, clientProtocol, status, createdTimeFrom, createdTimeTo }
  const [logs, total] = await Promise.all([
    listRequestLogs(pageSize, offset ?? 0, filter),
    countRequestLogs(filter),
  ])
  const entries: RequestLogEntry[] = await Promise.all(
    logs.map(mapRequestLogEntry),
  )

  sendSuccess(res, { logs: entries, total })
}

async function mapRequestLogEntry(log: RequestLog): Promise<RequestLogEntry> {
  const attempts = await listAttemptsByRequest(log.id)
  return {
    id: log.id,
    logicalModelId: log.logicalModelId,
    clientProtocol: log.clientProtocol,
    upstreamProtocol: log.upstreamProtocol,
    status: log.status,
    totalDurationMilliseconds: log.totalDurationMilliseconds,
    totalTokens: log.totalTokens,
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    reasoningTokens: log.reasoningTokens ?? null,
    cachedInputTokens: log.cachedInputTokens,
    cacheCreationInputTokens: log.cacheCreationInputTokens,
    promptCacheHit: log.promptCacheHit,
    rawUsage: log.rawUsage,
    ttftMilliseconds: log.ttftMilliseconds,
    cacheHit: log.cacheHit,
    createdTime: log.createdTime,
    attempts: attempts
      .sort((a, b) => a.attemptIndex - b.attemptIndex)
      .map(a => ({
        id: a.id,
        attemptIndex: a.attemptIndex,
        status: a.status,
        providerId: a.providerId,
        providerName: a.providerName,
        providerModelId: a.providerModelId,
        providerModelName: a.providerModelName,
        upstreamProtocol: a.upstreamProtocol,
        upstreamRequestId: a.upstreamRequestId,
        url: a.url,
        httpStatus: a.httpStatus,
        retryable: a.retryable,
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        durationMilliseconds: a.durationMilliseconds,
        createdTime: a.createdTime,
      })),
  }
}
