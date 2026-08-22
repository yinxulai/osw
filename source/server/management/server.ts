import http from 'node:http'
import { handleApiRequest } from './router'
import { applyManagementRequestGuards } from './request-guards'
import { normalizeError } from '../errors'
import { sendManagementError } from './response'
import type { Server } from 'node:http'
import type { RuntimeEnvironment } from '@common/runtime-profile'

export interface ManagementServerOptions {
  host?: string
  port?: number
  environment?: RuntimeEnvironment
}

let managementServer: Server | null = null
let startupPromise: Promise<Server> | null = null

export function startManagementServer(options: ManagementServerOptions = {}): Promise<Server> {
  if (managementServer?.listening) return Promise.resolve(managementServer)
  if (startupPromise) return startupPromise

  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 9301
  const environment = options.environment ?? 'production'
  const candidate = http.createServer((req, res) => {
    void handleManagementRequest(req, res, host, port, environment)
  })

  managementServer = candidate
  startupPromise = new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      candidate.off('listening', handleListening)
      if (managementServer === candidate) managementServer = null
      startupPromise = null
      reject(error)
    }
    const handleListening = () => {
      candidate.off('error', handleError)
      startupPromise = null
      console.log(`[one-switch] management server listening on ${host}:${port}`)
      resolve(candidate)
    }
    candidate.once('error', handleError)
    candidate.once('listening', handleListening)
    candidate.listen(port, host)
  })

  return startupPromise
}

async function handleManagementRequest(req: http.IncomingMessage, res: http.ServerResponse, host: string, port: number, environment: RuntimeEnvironment): Promise<void> {
  try {
    if (!await applyManagementRequestGuards(req.headers, req.method, req.url, res, host, port)) return
    await handleApiRequest(req, res, environment)
  } catch (error) {
    console.error(`[management] request boundary failed: ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'}`, error)
    if (res.headersSent || res.writableEnded) {
      res.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    handleApiRequestError(res, error)
  }
}

function handleApiRequestError(res: http.ServerResponse, error: unknown): void {
  const normalized = normalizeError(error)
  sendManagementError(res, normalized)
}

export async function stopManagementServer(): Promise<void> {
  if (startupPromise) await startupPromise
  const activeServer = managementServer
  managementServer = null
  if (!activeServer?.listening) return
  await new Promise<void>((resolve, reject) => {
    activeServer.close(error => error ? reject(error) : resolve())
  })
}
