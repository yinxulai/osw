import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import type { LogEntry } from '@common/schemas'
import { clearLogs, exportLogs, listLogs } from './log-buffer'

export const logRoutes: Record<string, ManagementHandler> = {
  '/api/logs/list': handleListLogs,
  '/api/logs/export': handleExportLogs,
  '/api/logs/clear': handleClearLogs,
}

const ListLogsSchema = z.object({ after: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(2000).optional() })

function handleListLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { after, limit } = ListLogsSchema.parse(body)
  const logs: LogEntry[] = listLogs({ after, limit })
  sendSuccess(res, { logs, latestId: logs.length > 0 ? logs[0].id : (after ?? 0) })
}

function handleExportLogs(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, { content: exportLogs() })
}

function handleClearLogs(_req: IncomingMessage, res: ServerResponse): void {
  clearLogs()
  sendSuccess(res, { cleared: true })
}
