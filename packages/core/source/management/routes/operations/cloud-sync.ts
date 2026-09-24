import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpRouter } from '../../../http-router'
import { sendSuccess } from '../../core/response'
import type { ManagementHandler } from '../../core/response'
import {
  configureCloudSync,
  getCloudSyncStatus,
  pullConfigSnapshot,
  pushConfigSnapshot,
  testCloudSync,
} from '../../cloud-sync/service'

/**
 * 云同步路由。
 *
 * 全部是显式动作用的 `POST /api/cloud-sync/<action>`（与其余管理接口同一套约定）：
 * 这些动作里有联网操作，用 GET 会让代理与日志把它们记成「读」。
 */
export const cloudSyncRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/cloud-sync/status', handleStatus)
  .post('/api/cloud-sync/configure', handleConfigure)
  .post('/api/cloud-sync/test', handleTest)
  .post('/api/cloud-sync/push', handlePush)
  .post('/api/cloud-sync/pull', handlePull)

async function handleStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await getCloudSyncStatus())
}

async function handleConfigure(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  sendSuccess(res, await configureCloudSync(body))
}

async function handleTest(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await testCloudSync())
}

async function handlePush(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await pushConfigSnapshot())
}

async function handlePull(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await pullConfigSnapshot())
}
