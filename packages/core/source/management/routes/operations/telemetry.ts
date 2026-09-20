import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseTelemetryEventInput } from '@common/telemetry'
import { previewTelemetry, reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { HttpRouter } from '@server/http-router'

/**
 * 统计的两个接口。
 *
 * - `preview`：**只读**，回答「现在到底会发出去什么」。开关本身走 `settings/update`（它就是一个
 *   普通设置项），这里不另开一个开关口。之所以单开接口而不是让控制台自己拼样例，是因为那份样例
 *   必须**是真的**——展示与上报出自同一个组装路径，否则「自证」就是摆设（telemetry.md §13）。
 * - `report`：界面侧发生的事（走完引导、新建 Provider）交给 core 上报。它不落盘、不入库，
 *   只是把事件丢进内存队列：容量、批量、丢弃策略统一由 core 决定，界面不该有第二套。
 *
 * 校验走 `parseTelemetryEventInput`（只认不含信封字段的那一半）：信封字段由 core 补，界面根本
 * 填不了，「客户端伪造 installId / version」这件事在这里就不成立。
 */
export const telemetryRoutes = new HttpRouter<ManagementHandler>()
  .get('/api/telemetry/preview', handlePreview)
  .post('/api/telemetry/report', handleReport)

async function handlePreview(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, previewTelemetry())
}

async function handleReport(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  // 非法事件**静默丢弃、照样回 200**：这是统计，不是业务写入。让界面因为「上报失败」而报错，
  // 等于把一条无所谓的数据变成用户的问题。事件名闭集由 schema 卡死，这里不做第二层校验。
  const event = parseTelemetryEventInput(body)
  if (event !== null) reportTelemetryEvent(event)
  sendSuccess(res, { accepted: event !== null })
}
