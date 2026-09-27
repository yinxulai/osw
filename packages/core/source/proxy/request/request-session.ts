import type { Settings } from '@common/schemas'
import { getSettings } from '@server/database/settings-store'
import { initializeRequestLogger } from '@server/proxy/observability/logging'
import type { RequestLoggingInput, RequestLogger } from '@server/proxy/observability/logging-types'

/** 一次代理请求在生命周期内固定使用的设置快照。 */
export type ProxyRequestSettings = Pick<
  Settings,
  'captureRequestLogs' | 'captureRequestContent' | 'idleTimeoutMilliseconds'
>

/**
 * 请求级 session。
 *
 * 时间、设置与日志器必须在请求进入代理的那一刻确定，并一路传给执行与收尾。分散地在入口、
 * 执行器和尝试里重新读取，会让同一个请求的不同阶段看到不同设置，也会产生互不可比的时间口径。
 */
export interface ProxyRequestSession {
  readonly startedAt: number
  readonly settings: ProxyRequestSettings
  readonly logger: RequestLogger
}

export type CreateProxyRequestSessionInput = Omit<RequestLoggingInput,
  'captureRequestLogs' | 'captureRequestContent'
> & {
  startedAt?: number
}

export async function createProxyRequestSession(input: CreateProxyRequestSessionInput): Promise<ProxyRequestSession> {
  const settings = await getSettings()
  const logger = await initializeRequestLogger({
    ...input,
    captureRequestLogs: settings.captureRequestLogs,
    captureRequestContent: settings.captureRequestContent,
  })
  return {
    startedAt: input.startedAt ?? Date.now(),
    settings: {
      captureRequestLogs: settings.captureRequestLogs,
      captureRequestContent: settings.captureRequestContent,
      idleTimeoutMilliseconds: settings.idleTimeoutMilliseconds,
    },
    logger,
  }
}
