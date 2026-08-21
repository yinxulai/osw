import http from 'node:http'
import { handleApiRequest } from './router'
import { isAllowedHost } from '../security/host-validation'
import { authorizeLocalRequest } from '../security/local-auth'
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
  const candidate = http.createServer(async (req, res) => {
    if (!isAllowedHost(req.headers.host, host, port)) {
      writeJsonError(res, 403, 'INVALID_HOST', 'Host 不被允许')
      return
    }
    if (!await authorizeLocalRequest(req.headers)) {
      writeJsonError(res, 401, 'UNAUTHORIZED', '需要有效的本地访问 Token')
      return
    }
    setCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const pathname = new URL(req.url!, 'http://localhost').pathname
    if (!pathname.startsWith('/api/')) {
      writeJsonError(res, 404, 'NOT_FOUND', '管理 API 路径不存在')
      return
    }
    if (req.method !== 'POST') {
      writeJsonError(res, 405, 'METHOD_NOT_ALLOWED', '只支持 POST 请求')
      return
    }
    await handleApiRequest(req, res, environment)
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

export async function stopManagementServer(): Promise<void> {
  if (startupPromise) await startupPromise
  const activeServer = managementServer
  managementServer = null
  if (!activeServer?.listening) return
  await new Promise<void>((resolve, reject) => {
    activeServer.close(error => error ? reject(error) : resolve())
  })
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

function writeJsonError(res: http.ServerResponse, statusCode: number, errorCode: string, errorMessage: string): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage }))
}
