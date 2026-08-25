import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ManagementHandler } from '../response'
import { sendError, sendSuccess } from '../response'
import { seedDevelopmentData } from '../../database/development-seed'
import { getSecretStore } from '../../infrastructure/secrets/secret-store'
import { exportConfig } from './export-config'
import { importConfig } from './import-config'
import { HttpRouter } from '../../http-router'

async function handleExportConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await exportConfig())
}

async function handleImportConfig(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  try {
    sendSuccess(res, await importConfig(body))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendError(res, 'VALIDATION_ERROR', `导入失败：${message}`, 400)
  }
}

async function handleSeedDevelopment(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const inserted = await seedDevelopmentData(getSecretStore(), { allowExisting: true })
  sendSuccess(res, { inserted })
}

export const configRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/config/export', handleExportConfig)
  .post('/api/config/import', handleImportConfig)
  .post('/api/config/seed-development', handleSeedDevelopment)
