import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from './response'
import { sendError, sendSuccess } from './response'
import type { RequestLog, RequestLogEntry } from '@common/schemas'
import { countRequestLogs, getRequestLog, listAttemptsByRequest, listRequestContents, listRequestLogs, pruneRequestLogsBefore } from '../database/request-log-store'

export const requestLogRoutes: Record<string, ManagementHandler> = {
  '/api/request-log/list': handleListRequestLogs,
  '/api/request-log/detail': handleRequestLogDetail,
  '/api/request-log/prune': handlePruneRequestLogs,
}

const ListRequestLogsSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  providerId: z.string().optional(),
  logicalModelId: z.string().optional(),
  protocol: z.string().optional(),
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
    sendError(res, 'RESOURCE_NOT_FOUND', `请求日志不存在: ${id}`, 404)
    return
  }
  const [entry, contents] = await Promise.all([
    mapRequestLogEntry(log),
    listRequestContents(id),
  ])
  sendSuccess(res, { ...entry, contents })
}

async function handlePruneRequestLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { retentionDays } = PruneRequestLogsSchema.parse(body ?? {})
  const deleted = await pruneRequestLogsBefore(retentionDays)
  sendSuccess(res, { deleted })
}

async function handleListRequestLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { limit, offset, providerId, logicalModelId, protocol, status, createdTimeFrom, createdTimeTo } = ListRequestLogsSchema.parse(body ?? {})
  const pageSize = limit ?? 50
  const filter = { providerId, logicalModelId, protocol, status, createdTimeFrom, createdTimeTo }
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
        protocol: log.protocol,
        upstreamProtocol: log.upstreamProtocol,
        status: log.status,
        totalDurationMilliseconds: log.totalDurationMilliseconds,
        totalTokens: log.totalTokens,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
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
            providerProtocol: a.providerProtocol,
            providerRequestId: a.providerRequestId,
            url: a.url,
            httpStatus: a.httpStatus,
            retryable: a.retryable,
            errorCode: a.errorCode,
            errorMessage: a.errorMessage,
            details: a.details,
            durationMilliseconds: a.durationMilliseconds,
            createdTime: a.createdTime,
          })),
  }
}
