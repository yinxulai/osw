import type { IncomingMessage, ServerResponse } from 'node:http'
import { SettingsSchema } from '@common/schemas'
import { getSettings, updateSettings } from '../database/settings-store'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'
import { HttpRouter } from '../http-router'

export const settingsRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/settings/get', handleGetSettings)
  .post('/api/settings/update', handleUpdateSettings)

async function handleGetSettings(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await getSettings())
}

const UpdateSettingsSchema = SettingsSchema.partial().omit({ id: true })
async function handleUpdateSettings(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  sendSuccess(res, await updateSettings(UpdateSettingsSchema.parse(body)))
}
