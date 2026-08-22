import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ManagementHandler } from '../response'
import { sendSuccess } from '../response'
import {
  deleteLocalAccessToken,
  generateLocalAccessToken,
  getLocalAuthStatus,
  rotateLocalAccessToken,
} from './service'

export const localAuthRoutes: Record<string, ManagementHandler> = {
  '/api/local-auth/status': handleStatus,
  '/api/local-auth/generate': handleGenerate,
  '/api/local-auth/rotate': handleRotate,
  '/api/local-auth/delete': handleDelete,
}

async function handleStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await getLocalAuthStatus())
}

async function handleGenerate(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, { token: await generateLocalAccessToken() })
}

async function handleRotate(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, { token: await rotateLocalAccessToken() })
}

async function handleDelete(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  await deleteLocalAccessToken()
  sendSuccess(res, { enabled: false })
}
