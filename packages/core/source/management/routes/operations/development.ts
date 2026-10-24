import type { IncomingMessage, ServerResponse } from 'node:http'
import { seedDevelopmentData } from '@server/database/development-seed'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { HttpRouter } from '@server/http-router'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'

/**
 * 开发环境专用接口。路径访问权限由 `gateway/development.ts` 限制为 development，
 * 生产环境会直接返回 404，因此这里不需要额外判断环境。
 */
export const developmentRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/development/seed', handleSeedDevelopment)

async function handleSeedDevelopment(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const inserted = await seedDevelopmentData(getSecretStore(), { allowExisting: true })
  sendSuccess(res, { inserted })
}
