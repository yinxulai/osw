import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { isAllowedHost } from '../security/host-validation'
import { sendError } from './response'

export async function applyManagementRequestGuards(headers: IncomingHttpHeaders, method: string | undefined, url: string | undefined, res: ServerResponse, host: string, port: number): Promise<boolean> {
  setCorsHeaders(res)
  if (!isAllowedHost(headers.host, host, port)) {
    sendError(res, 'HOST_NOT_ALLOWED', 'Host 不被允许', 403)
    return false
  }
  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return false
  }
  const pathname = new URL(url!, 'http://localhost').pathname
  if (!pathname.startsWith('/api/')) {
    sendError(res, 'RESOURCE_NOT_FOUND', '管理 API 路径不存在', 404)
    return false
  }
  if (method !== 'POST') {
    sendError(res, 'METHOD_NOT_ALLOWED', '只支持 POST 请求', 405)
    return false
  }
  return true
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}
