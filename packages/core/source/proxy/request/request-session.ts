import type { Settings } from '@common/schemas'
import { getSettings } from '@server/database/settings-store'
import { initializeRequestLogger } from '@server/proxy/observability/logging'
import type { RequestLoggingInput, RequestLogger } from '@server/proxy/observability/logging-types'

/** 一次代理请求在生命周期内固定使用的设置快照。 */
export type ProxyRequestSettings = Pick<
  Settings,
  'captureRequestLogs' | 'captureRequestContent' | 'idleTimeoutMilliseconds' | 'apiKeyAuthEnabled'
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
      // 整个模块关掉时，校验开关必须一起失效：模块都不在界面上出现了，再返回 401
      // 只会变成一个无法排查、也无处关闭的拦截。折算放在这一层做，消费方读到的仍是单个布尔。
      apiKeyAuthEnabled: settings.apiKeyFeatureEnabled && settings.apiKeyAuthEnabled,
    },
    logger,
  }
}
