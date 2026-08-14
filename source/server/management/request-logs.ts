import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import { listAttemptsByRequest, listProviders, listRequestLogs } from '../database/store'

export const requestLogRoutes: Record<string, ManagementHandler> = {
  '/api/request-log/list': handleListRequestLogs,
}

const ListRequestLogsSchema = z.object({ limit: z.number().int().positive().max(200).optional() })

interface RequestLogEntry {
  id: string
  logicalModelId: string
  protocol: string
  status: string
  totalDurationMilliseconds: number
  totalTokens: number | null
  createdTime: number
  attempts: Array<{
    attemptIndex: number
    status: string
    providerId: string
    providerName: string
    upstreamModelId: string
    errorCode: string | null
    errorMessage: string | null
    durationMilliseconds: number
    createdTime: number
  }>
}

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
            durationMilliseconds: a.durationMilliseconds,
            createdTime: a.createdTime,
          })),
      }
    }),
  )

  sendSuccess(res, { logs: entries })
}
