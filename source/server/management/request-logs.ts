import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import type { RequestLogEntry } from '@common/schemas'
import { listAttemptsByRequest, listProviders, listRequestLogs } from '../database/store'

export const requestLogRoutes: Record<string, ManagementHandler> = {
  '/api/request-log/list': handleListRequestLogs,
}

const ListRequestLogsSchema = z.object({ limit: z.number().int().positive().max(200).optional() })

async function handleListRequestLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { limit } = ListRequestLogsSchema.parse(body ?? {})
  const logs = await listRequestLogs(limit ?? 50)
  const providers = await listProviders()
  const providerNameById = new Map(providers.map(p => [p.id, p.name]))

  const entries: RequestLogEntry[] = await Promise.all(
    logs.map(async log => {
      const attempts = await listAttemptsByRequest(log.id)
      return {
        id: log.id,
        logicalModelId: log.logicalModelId,
        protocol: log.protocol,
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
            attemptIndex: a.attemptIndex,
            status: a.status,
            providerId: a.providerId,
            providerName: providerNameById.get(a.providerId) ?? a.providerId,
            upstreamModelId: a.upstreamModelId,
            errorCode: a.errorCode,
            errorMessage: a.errorMessage,
            upstreamRequestId: a.upstreamRequestId,
            errorResponse: a.errorResponse,
            durationMilliseconds: a.durationMilliseconds,
            createdTime: a.createdTime,
          })),
      }
    }),
  )

  sendSuccess(res, { logs: entries })
}
