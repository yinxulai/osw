/**
 * 上报的发送端：把一批事件 POST 到自建端点。
 *
 * **它用一个专用的直连连接器，不走 `coreNetworkClient` 单例。**
 * 那个单例承载的是「用户为模型请求配的出站代理」语义，统计流量混进去会有两个坏结果：
 * 用户的代理日志里出现他没预期的目标；以及代理配错时统计会永久失败
 * （见 `docs/product/telemetry.md` §1「与出站代理的关系」、`outbound-proxy.md`「非目标」）。
 *
 * 这里也**不使用系统的出站代理**：模式固定为 `direct`，`systemProxyResolver` 用默认的
 * 「不解析」，所以「统计流量永不经过代理」是结构上成立的，不是靠某个配置项恰好为空。
 *
 * 失败一律抛错，由调用方决定怎么处理（那边只记一行 debug）——这个文件不认识「静默」这个词。
 */

import type { TelemetryBatch } from '@common/telemetry'
import { TELEMETRY_REQUEST_TIMEOUT_MILLISECONDS } from '@common/telemetry'
import { createCoreNetworkClient } from '../infrastructure/network/core-network'
import { createOutboundConnector, type OutboundProxySettings } from '../infrastructure/network/outbound-connector'

export type TelemetrySender = (endpoint: string, batch: TelemetryBatch) => Promise<void>

/**
 * 固定的 User-Agent。
 *
 * 报文里本来就不带任何用户代理的痕迹，如果连请求头都沿用宿主（Electron 的 UA 里有系统与
 * 内核版本），那就等于在信封上又写了一遍；这里只声明「是 OSW 的统计流量」这一件事。
 */
const TELEMETRY_USER_AGENT = 'OSW-Telemetry'

const DIRECT_SETTINGS: OutboundProxySettings = {
  outboundProxyMode: 'direct',
  outboundProxyUrl: '',
  outboundProxyBypass: '',
}

export function createTelemetrySender(): TelemetrySender {
  return async (endpoint, batch) => {
    const target = new URL(endpoint)
    const payload = Buffer.from(JSON.stringify(batch), 'utf8')

    // 连接器按次创建、用完销毁：上报间隔是几十秒量级，为它养一个带 keep-alive 的长连接
    // 反而多一份要在关闭流程里收回的资源。先例见 `management/routes/diagnostics/outbound-proxy-test.ts`。
    const connector = createOutboundConnector(() => DIRECT_SETTINGS)
    await connector.initialize()
    const client = createCoreNetworkClient(connector)
    try {
      const response = await client.requestHttpBuffered(target, {
        method: 'POST',
        hostname: target.hostname,
        // 端口必须显式带上：`URL` 的 `port` 在默认端口时是空串，交给 `http.request` 会走 80，
        // 于是「指向本地 Worker 的开发端点」会被静默打到别处。
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          'user-agent': TELEMETRY_USER_AGENT,
        },
        timeout: TELEMETRY_REQUEST_TIMEOUT_MILLISECONDS,
      }, payload)

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`telemetry endpoint responded with ${response.statusCode}`)
      }
    } finally {
      connector.destroy()
    }
  }
}
