import type { IncomingMessage, ServerResponse } from 'node:http'
import { normalizeError } from '@server/errors'
import { sendManagementError } from './response'

export function handleApiError(req: IncomingMessage, res: ServerResponse, error: unknown): void {
  const normalized = normalizeError(error)
  const message = `[management] request failed method=${req.method ?? 'UNKNOWN'} path=${req.url ?? '/'} status=${normalized.statusCode} code=${normalized.code} message=${normalized.message}`
  if (normalized.statusCode >= 500) console.error(message, normalized)
  else console.warn(message)
  if (res.headersSent || res.writableEnded) {
    res.destroy(normalized)
    return
  }
  sendManagementError(res, normalized)
}
