import type { IncomingMessage, ServerResponse } from 'node:http'

export type ManagementHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void

export function sendSuccess(res: ServerResponse, data: unknown): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: true, data }))
}

export function sendError(res: ServerResponse, errorCode: string, errorMessage: string, statusCode = 400): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage }))
}
