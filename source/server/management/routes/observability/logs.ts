import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import type { LogEntry } from '@common/schemas'
import { clearLogs, exportLogs, listLogs } from '../../infrastructure/log-buffer'
import { HttpRouter } from '@server/http-router'

export const logRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/logs/list', handleListLogs)
  .post('/api/logs/export', handleExportLogs)
  .post('/api/logs/clear', handleClearLogs)

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
