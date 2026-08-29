import type { IncomingMessage, ServerResponse } from 'node:http'
import { SettingsSchema } from '@common/schemas'
import { getSettings, updateSettings } from '@server/database/settings-store'
import { validateOutboundProxyModeAndUrl } from '@server/infrastructure/network/outbound-proxy'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { HttpRouter } from '@server/http-router'

export const settingsRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/settings/get', handleGetSettings)
  .post('/api/settings/update', handleUpdateSettings)

async function handleGetSettings(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await getSettings())
}

const UpdateSettingsSchema = SettingsSchema.partial().omit({ id: true })
async function handleUpdateSettings(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const updates = UpdateSettingsSchema.parse(body)
  if (updates.outboundProxyMode !== undefined || updates.outboundProxyUrl !== undefined) {
    const current = await getSettings()
    validateOutboundProxyModeAndUrl(
      updates.outboundProxyMode ?? current.outboundProxyMode,
      updates.outboundProxyUrl ?? current.outboundProxyUrl,
    )
  }
  sendSuccess(res, await updateSettings(updates))
}
