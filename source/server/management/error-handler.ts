import type { ServerResponse } from 'node:http'
import { z } from 'zod'
import { sendError } from './response'

export function handleApiError(res: ServerResponse, error: unknown): void {
  if (error instanceof z.ZodError) {
    sendError(res, 'VALIDATION_ERROR', error.errors.map(issue => issue.message).join('; '), 400)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  sendError(res, 'INTERNAL_ERROR', message, 500)
}
