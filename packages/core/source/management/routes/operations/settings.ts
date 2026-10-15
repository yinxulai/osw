import type { IncomingMessage, ServerResponse } from 'node:http'
import { SettingsSchema, withoutDefaults } from '@common/schemas'
import { getSettings, updateSettings } from '@server/database/settings-store'
import { validateOutboundProxyModeAndUrl } from '@server/infrastructure/network/outbound-proxy'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { HttpRouter } from '@server/http-router'

export const settingsRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/settings/get', handleGetSettings)
  .post('/api/settings/update', handleUpdateSettings)

async function handleGetSettings(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await getSettings())
}

/**
 * `withoutDefaults` 是这儿的关键，不是修饰：`SettingsSchema` 里近三十个字段都带 `.default()`，
 * 而 zod v4 的 `.partial()` 会在字段缺省时照旧套上默认值。少了这一道，界面保存**任何**一项
 * 设置都会把整份设置回写成默认值——用户改一下监听端口，抓正文、遥测、云同步全被静默重置。
 * 详见 `withoutDefaults` 的注释。
 */
const UpdateSettingsSchema = withoutDefaults(SettingsSchema).partial().omit({ id: true })
async function handleUpdateSettings(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const updates = UpdateSettingsSchema.parse(body)
  const current = await getSettings()
  if (updates.outboundProxyMode !== undefined || updates.outboundProxyUrl !== undefined) {
    validateOutboundProxyModeAndUrl(
      updates.outboundProxyMode ?? current.outboundProxyMode,
      updates.outboundProxyUrl ?? current.outboundProxyUrl,
    )
  }
  const updated = await updateSettings(updates)
  // 「切换生效模式」是一次产品行为，而这里是它唯一的写入口。**只有真的变了才发**：
  // 界面保存任何一项设置都会把整个设置对象回写一遍，按「收到这个字段」计数
  // 只会数出「保存过几次设置」（契约注释）。
  if (updates.routeMode !== undefined && updates.routeMode !== current.routeMode) {
    reportTelemetryEvent({ name: 'route_mode_changed', mode: updated.routeMode })
  }
  sendSuccess(res, updated)
}
