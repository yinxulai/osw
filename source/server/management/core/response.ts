import type { IncomingMessage, ServerResponse } from 'node:http'
import { getErrorResponseMessage, normalizeError } from '../../errors'

export type ManagementHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void

export function sendSuccess(res: ServerResponse, data: unknown): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: true, data }))
}

export function sendError(res: ServerResponse, errorCode: string, errorMessage: string, statusCode = 400): void {
  if (res.writableEnded) return
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage }))
}

export function sendManagementError(res: ServerResponse, error: unknown): void {
  const normalized = normalizeError(error)
  sendError(
    res,
    normalized.code,
    getErrorResponseMessage(normalized, '服务器内部错误'),
    normalized.statusCode,
  )
}
