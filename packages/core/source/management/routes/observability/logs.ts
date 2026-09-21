import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { clearLogs, exportLogs, listLogsPaged } from '../../infrastructure/log-buffer'
import { HttpRouter } from '@server/http-router'

export const logRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/logs/list', handleListLogs)
  .post('/api/logs/export', handleExportLogs)
  .post('/api/logs/clear', handleClearLogs)

const ListLogsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
  level: z.enum(['log', 'warn', 'error', 'info', 'debug']).optional(),
  query: z.string().max(500).optional(),
})

function handleListLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { limit, offset, level, query } = ListLogsSchema.parse(body)
  const pageSize = limit ?? 100
  const normalizedQuery = query?.trim() || undefined
  const result = listLogsPaged(pageSize, offset ?? 0, { level, query: normalizedQuery })
  sendSuccess(res, { logs: result.logs, total: result.total })
}

function handleExportLogs(_req: IncomingMessage, res: ServerResponse): void {
  // 导出**不埋点**：这一段是纯文本的运行日志，从来不带请求 / 响应正文，所以上报它所能说的
  // 只有「用户点过一次下载」——不值得占一个事件名（契约注释里有完整取舍）。
  sendSuccess(res, { content: exportLogs() })
}

function handleClearLogs(_req: IncomingMessage, res: ServerResponse): void {
  clearLogs()
  sendSuccess(res, { cleared: true })
}
