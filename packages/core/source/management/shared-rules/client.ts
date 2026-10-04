/**
 * 共享重写规则目录的**出站客户端**：本机管理服务把界面的浏览 / 发布 / 使用请求转发给
 * `apps/apis` 上的目录端点。
 *
 * 这一层存在，而不是让渲染层直连目录，理由与遥测完全相同：**只有一条链路、一个地址**。
 * 目录地址跟着 `settings.telemetryEndpoint` 走（同一个 Worker 的第二条路由），于是开发档
 * 把遥测打到本地 `wrangler dev` 时，目录也一起打过去——一个开关同时管住两条对外的腿，
 * 不必在两个地方各配一次。
 *
 * ## 不走 `coreNetworkClient` 单例
 *
 * 与遥测发送端同源：那个单例承载的是「用户为**模型请求**配的出站代理」语义。目录流量混进去
 * 会有两个坏结果——用户的代理日志里出现他没预期的目标，以及代理配错时目录会永久失败。
 * 所以这里按次建一个 `direct` 连接器，用完销毁：目录是低频动作（点一次按钮），
 * 不值得为它养一个长连接。
 *
 * 失败一律抛 `AppError`，由路由层翻译成响应——这个文件不认识「静默」这个词。
 */

import type { SharedRewriteRule, SharedRewriteRuleGetInput, SharedRewriteRuleListInput, SharedRewriteRuleListResult, SharedRewriteRulePayload, SharedRewriteRuleUseInput } from '@common/shared-rewrite-rules'
import { SHARED_REWRITE_RULES_ENDPOINT, SHARED_REWRITE_RULES_PATH } from '@common/shared-rewrite-rules'
import { AppError } from '@server/errors'
import { getSettings } from '@server/database/settings-store'
import { createCoreNetworkClient } from '@server/infrastructure/network/core-network'
import { createOutboundConnector, type OutboundProxySettings } from '@server/infrastructure/network/outbound-connector'

/** 与遥测发送端同一口径：目录流量声明「是 OSW 发的」，不夹带宿主 UA。 */
const SHARED_RULES_USER_AGENT = 'OSW-Shared-Rules'
const REQUEST_TIMEOUT_MILLISECONDS = 10_000

const DIRECT_SETTINGS: OutboundProxySettings = {
  outboundProxyMode: 'direct',
  outboundProxyUrl: '',
  outboundProxyBypass: '',
}

/**
 * 目录地址：把遥测端点的路径换成目录路径，保留主机（含本地开发用的端口）。
 *
 * `telemetryEndpoint` 为空时退回内置常量。这样「开发档指向本地」与「正式档指向自有域名」
 * 是同一条规则推出来的，不需要为目录单独再开一个设置项——两个地址本来就该一起变。
 */
async function resolveEndpoint(): Promise<string> {
  const settings = await getSettings().catch(() => null)
  const telemetry = settings?.telemetryEndpoint.trim() ?? ''
  if (telemetry === '') return SHARED_REWRITE_RULES_ENDPOINT

  const parsed = new URL(telemetry)
  parsed.pathname = SHARED_REWRITE_RULES_PATH
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

/** 目录对一条 `{ ok, ... }` 应答的统一形状；失败时带 `error` 码。 */
interface RegistryEnvelope {
  ok: boolean
  error?: string
  message?: string
  rule?: SharedRewriteRule
  rules?: SharedRewriteRule[]
  total?: number
  limit?: number
  offset?: number
}

async function post(action: 'list' | 'get' | 'publish' | 'use', body: unknown): Promise<RegistryEnvelope> {
  const endpoint = await resolveEndpoint()
  const target = new URL(`${endpoint.replace(/\/$/, '')}/${action}`)
  const payload = Buffer.from(JSON.stringify(body), 'utf8')

  const connector = createOutboundConnector(() => DIRECT_SETTINGS)
  await connector.initialize()
  const client = createCoreNetworkClient(connector)
  try {
    const response = await client.requestHttpBuffered(target, {
      method: 'POST',
      hostname: target.hostname,
      // 端口显式带上：`URL.port` 在默认端口时是空串，交给 `http.request` 会走 80。
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        'user-agent': SHARED_RULES_USER_AGENT,
      },
      timeout: REQUEST_TIMEOUT_MILLISECONDS,
    }, payload)

    let parsed: RegistryEnvelope
    try {
      parsed = JSON.parse(response.body) as RegistryEnvelope
    } catch {
      throw new AppError('INVALID_RESPONSE', 502, `Shared rules endpoint returned non-JSON (${response.statusCode})`)
    }
    if (response.statusCode === 404) {
      throw new AppError('RESOURCE_NOT_FOUND', 404, parsed.message ?? 'Shared rule not found')
    }
    if (response.statusCode < 200 || response.statusCode >= 300 || !parsed.ok) {
      throw new AppError('UPSTREAM_ERROR', 502, parsed.message ?? parsed.error ?? `Shared rules endpoint responded with ${response.statusCode}`)
    }
    return parsed
  } finally {
    connector.destroy()
  }
}

export async function listSharedRules(input: SharedRewriteRuleListInput): Promise<SharedRewriteRuleListResult> {
  const result = await post('list', input)
  return {
    rules: result.rules ?? [],
    total: result.total ?? 0,
    limit: result.limit ?? input.limit,
    offset: result.offset ?? input.offset,
  }
}

export async function getSharedRule(input: SharedRewriteRuleGetInput): Promise<SharedRewriteRule> {
  const result = await post('get', input)
  if (!result.rule) throw new AppError('INVALID_RESPONSE', 502, 'Shared rules endpoint returned no rule')
  return result.rule
}

export async function publishSharedRule(rule: SharedRewriteRulePayload): Promise<SharedRewriteRule> {
  const result = await post('publish', { rule })
  if (!result.rule) throw new AppError('INVALID_RESPONSE', 502, 'Shared rules endpoint returned no rule')
  return result.rule
}

export async function useSharedRule(input: SharedRewriteRuleUseInput): Promise<SharedRewriteRule> {
  const result = await post('use', input)
  if (!result.rule) throw new AppError('INVALID_RESPONSE', 502, 'Shared rules endpoint returned no rule')
  return result.rule
}
