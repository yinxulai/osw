import { LIVE_REQUEST_STREAM_PROTOCOL_VERSION, type LiveRequestStreamMessage } from '@common/live-request-stream'
import { LIVE_METRICS_STREAM_PROTOCOL_VERSION, type LiveMetricsStreamMessage } from '@common/live-metrics-stream'
import { parseStreamLine, readNdjsonStream } from './ndjson'

export interface LiveRequestStreamOptions {
  signal: AbortSignal
  onMessage: (message: LiveRequestStreamMessage) => void
}

export interface LiveMetricsStreamOptions {
  signal: AbortSignal
  onMessage: (message: LiveMetricsStreamMessage) => void
}

/**
 * 逐帧读取「进行中的请求」推送流。
 *
 * 分帧与装包（攒缓冲、切行、半行容错、畸形帧的丢弃）在 `./ndjson`——诊断那条**会结束**的
 * 运行流用的是同一份，这里只描述这一条流的判据。
 */
export async function readLiveRequestStream(options: LiveRequestStreamOptions): Promise<void> {
  await readNdjsonStream('/request-log/live/stream', {}, options.signal, line => parseStreamLine(line, isLiveRequestStreamMessage, 'live request'), options.onMessage)
}

/**
 * 逐帧读取「实时指标」推送流。
 *
 * 与 {@link readLiveRequestStream} 完全同构（同一条 NDJSON 分帧逻辑），只是数据源与判据不同：
 * 这条订阅管理 API 的 `/api/live-metrics/stream`，把菜单栏标题用的同一份标准指标也读进来，
 * 供应用窗口里的指标渲染。同一份数、两块画布（见 `@common/live-metrics`）。
 */
export async function readLiveMetricsStream(options: LiveMetricsStreamOptions): Promise<void> {
  await readNdjsonStream('/live-metrics/stream', {}, options.signal, line => parseStreamLine(line, isLiveMetricsStreamMessage, 'live metrics'), options.onMessage)
}

function isLiveRequestStreamMessage(value: unknown): value is LiveRequestStreamMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { protocolVersion?: unknown; type?: unknown; requests?: unknown }
  if (message.protocolVersion !== LIVE_REQUEST_STREAM_PROTOCOL_VERSION) return false
  if (message.type === 'heartbeat') return true
  return message.type === 'snapshot' && Array.isArray(message.requests)
}

function isLiveMetricsStreamMessage(value: unknown): value is LiveMetricsStreamMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { protocolVersion?: unknown; type?: unknown; metrics?: unknown }
  if (message.protocolVersion !== LIVE_METRICS_STREAM_PROTOCOL_VERSION) return false
  if (message.type === 'heartbeat') return true
  return message.type === 'snapshot' && typeof message.metrics === 'object' && message.metrics !== null
}
