import http from 'node:http'
import { handleApiRequest } from './router'
import { applyManagementRequestGuards } from './request-guards'
import { normalizeError } from '@server/errors'
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
  console.log(`[management-lifecycle] start requested host=${options.host ?? '127.0.0.1'} port=${options.port ?? 9301} listening=${managementServer?.listening ?? false} startupPending=${Boolean(startupPromise)}`)
  if (managementServer?.listening) return Promise.resolve(managementServer)
  if (startupPromise) return startupPromise

  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 9301
  const environment = options.environment ?? 'production'
  const candidate = http.createServer((req, res) => {
    void handleManagementRequest(req, res, environment)
  })

  managementServer = candidate
  startupPromise = new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      console.error(`[management-lifecycle] listen error host=${host} port=${port}`, error)
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

async function handleManagementRequest(req: http.IncomingMessage, res: http.ServerResponse, environment: RuntimeEnvironment): Promise<void> {
  console.log(`[management] request begin ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} host=${req.headers.host ?? 'none'}`)
  try {
    if (!await applyManagementRequestGuards(req.method, req.url, res)) {
      console.warn(`[management] request rejected by guard ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'}`)
      return
    }
    await handleApiRequest(req, res, environment)
    console.log(`[management] request completed ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} status=${res.statusCode}`)
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
  console.log(`[management-lifecycle] stop requested listening=${managementServer?.listening ?? false} startupPending=${Boolean(startupPromise)}`)
  if (startupPromise) await startupPromise
  const activeServer = managementServer
  managementServer = null
  if (!activeServer?.listening) {
    console.log('[management-lifecycle] stop skipped: server is not listening')
    return
  }
  console.log('[management-lifecycle] closing management server')
  activeServer.closeIdleConnections?.()
  activeServer.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    activeServer.close(error => error ? reject(error) : resolve())
  })
  console.log('[management-lifecycle] stop completed')
}
