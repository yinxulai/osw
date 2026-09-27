import { LIVE_REQUEST_STREAM_PROTOCOL_VERSION, type LiveRequestStreamMessage } from '@common/live-request-stream'
import { openStream } from './client'

export interface LiveRequestStreamOptions {
  signal: AbortSignal
  onMessage: (message: LiveRequestStreamMessage) => void
}

/**
 * 逐帧读取「进行中的请求」推送流。
 *
 * 传输是 NDJSON：服务端每帧写一条版本化消息加一个换行。这里负责分帧与版本边界，
 * 业务 payload 仍与 `request<T>` 一样由 `@osw/contracts` 定义，不在热路径深拷贝校验。
 *
 * 半行是真实存在的（连接会在任意一个字节上被掐断），因此解析失败的行直接丢掉：
 * 下一条 `snapshot` 本来就是全量的，丢掉半行不会留下不一致，而为一条残帧把整条推送打断
 * 则是纯损失。版本、消息类型与快照容器必须完整，缺一项就不交给消费方猜测。
 * 但 `onMessage` 自己抛出的异常不受这份宽容保护——那是消费方的问题，会被原样上抛。
 *
 * 结束即返回（正常断开与 `signal` 中止都算），重连交给调用方——退避策略属于「谁在用它」，
 * 不属于「怎么读它」。
 */
export async function readLiveRequestStream(options: LiveRequestStreamOptions): Promise<void> {
  const stream = await openStream('/request-log/live/stream', { signal: options.signal })
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        deliver(line, options.onMessage)
      }
    }
  } finally {
    // 放开读取端：从中途退出（消费方抛错、外部中止）时连接可能还活着，不 cancel 就留下一条
    // 没人读的连接。流已经正常结束或已经出错时这一行是空操作，所以它只在中途退出时才起作用。
    void reader.cancel().catch(() => undefined)
  }
}

function deliver(line: string, onMessage: (message: LiveRequestStreamMessage) => void): void {
  if (line.length === 0) return
  let message: unknown
  try {
    message = JSON.parse(line) as unknown
  } catch {
    console.warn('[console] dropped a malformed live request frame')
    return
  }
  if (!isLiveRequestStreamMessage(message)) {
    console.warn('[console] dropped an unsupported live request stream message')
    return
  }
  // 消费方抛错**不属于**畸形帧：把两者放在同一个 try 里，会把「界面渲染崩了」记成
  // 「收到一帧坏数据」，还会把真正的异常吞掉。它照旧往上抛，由调用方决定重连还是收摊。
  onMessage(message)
}

/**
 * 只守住线路协议边界，不逐字段校验 `requests`。
 *
 * 这个服务与界面同版本发布、只监听回环地址；业务字段可信度沿用其他管理 API 的约定。
 * 这里负责拒绝旧协议或未知消息，避免它们被静默解释成一次状态替换。
 */
function isLiveRequestStreamMessage(value: unknown): value is LiveRequestStreamMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { protocolVersion?: unknown; type?: unknown; requests?: unknown }
  if (message.protocolVersion !== LIVE_REQUEST_STREAM_PROTOCOL_VERSION) return false
  if (message.type === 'heartbeat') return true
  return message.type === 'snapshot' && Array.isArray(message.requests)
}
