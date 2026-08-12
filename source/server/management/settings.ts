import type { IncomingMessage, ServerResponse } from 'node:http'
import { SettingsSchema } from '@common/schemas'
import { getSettings, updateSettings } from '../database/store'
import type { ManagementHandler } from './response'
import { sendSuccess } from './response'

export const settingsRoutes: Record<string, ManagementHandler> = {
  '/api/settings/get': handleGetSettings,
  '/api/settings/update': handleUpdateSettings,
}

function handleGetSettings(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, getSettings())
}

const UpdateSettingsSchema = SettingsSchema.partial().omit({ id: true })
function handleUpdateSettings(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  sendSuccess(res, updateSettings(UpdateSettingsSchema.parse(body)))
}
