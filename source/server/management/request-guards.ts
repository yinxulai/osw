import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { isAllowedHost } from '../security/host-validation'
import { authorizeLocalRequest } from './auth/service'

export async function applyManagementRequestGuards(headers: IncomingHttpHeaders, method: string | undefined, url: string | undefined, res: ServerResponse, host: string, port: number): Promise<boolean> {
  if (!isAllowedHost(headers.host, host, port)) {
    writeJsonError(res, 403, 'INVALID_HOST', 'Host 不被允许')
    return false
  }
  if (!await authorizeLocalRequest(headers)) {
    writeJsonError(res, 401, 'UNAUTHORIZED', '需要有效的本地访问 Token')
    return false
  }
  setCorsHeaders(res)
  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return false
  }
  const pathname = new URL(url!, 'http://localhost').pathname
  if (!pathname.startsWith('/api/')) {
    writeJsonError(res, 404, 'NOT_FOUND', '管理 API 路径不存在')
    return false
  }
  if (method !== 'POST') {
    writeJsonError(res, 405, 'METHOD_NOT_ALLOWED', '只支持 POST 请求')
    return false
  }
  return true
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

function writeJsonError(res: ServerResponse, statusCode: number, errorCode: string, errorMessage: string): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage }))
}
