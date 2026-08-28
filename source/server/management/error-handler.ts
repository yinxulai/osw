import type { IncomingMessage, ServerResponse } from 'node:http'
import { normalizeError } from '@server/errors'
import { sendManagementError } from './response'

export function handleApiError(req: IncomingMessage, res: ServerResponse, error: unknown): void {
  const normalized = normalizeError(error)
  console.error(`[management] request failed: ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} code=${normalized.code} message=${normalized.message}`)
  if (res.headersSent || res.writableEnded) {
    res.destroy(normalized)
    return
  }
  sendManagementError(res, normalized)
}
