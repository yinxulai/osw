import http from 'node:http'
import { handleApiRequest } from './api/handlers'
import { handleProxyRequest } from './proxy/handler'
import { initDatabase, getDb } from './db'
import { getSettings } from './db/store'
import type { Server } from 'node:http'

let server: Server | null = null

export interface StartServerOptions {
  dataDir: string
}

export function startServer(options: StartServerOptions): Server {
  if (server) return server

  initDatabase(options.dataDir)

  const settings = getSettings()

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    const pathname = url.pathname

    // 管理 API
    if (pathname.startsWith('/api/')) {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: false, errorCode: 'METHOD_NOT_ALLOWED', errorMessage: '只支持 POST 请求' }))
        return
      }
      await handleApiRequest(req, res)
      return
    }

    // 代理请求
    await handleProxy(req, res)
  })

  server.listen(settings.listenPort, settings.listenHost, () => {
    console.log(`[one-switch] server listening on ${settings.listenHost}:${settings.listenPort}`)
  })

  return server
}

export function stopServer(): void {
  if (server) {
    server.close()
    server = null
  }
  const db = getDb()
  db.close()
}

async function handleProxy(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // MVP: 默认使用第一个逻辑模型
  // 后续可以从 header 或路径中解析模型
  const { listLogicalModels } = await import('./db/store')
  const models = listLogicalModels()

  if (models.length === 0) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        success: false,
        errorCode: 'NO_MODEL_CONFIGURED',
        errorMessage: '还没有配置逻辑模型',
      }),
    )
    return
  }

  // MVP: 单队列，用第一个模型
  await handleProxyRequest(req, res, models[0].id)
}
