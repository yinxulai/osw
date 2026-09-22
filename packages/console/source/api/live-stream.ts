import type { LiveRequestSnapshot } from '@common/schemas'
import { openStream } from './client'

export interface LiveRequestStreamOptions {
  signal: AbortSignal
  onSnapshot: (snapshot: LiveRequestSnapshot) => void
}

/**
 * 逐帧读取「进行中的请求」推送流。
 *
 * 传输是 NDJSON：服务端每帧写一行完整快照加一个换行。这里只负责分帧，不校验形状——
 * 与 `request<T>` 一致，形状由 `@osw/contracts` 定义，运行时不再验第二遍。
 *
 * 半行是真实存在的（连接会在任意一个字节上被掐断），因此解析失败的行直接丢掉：
 * 下一帧本来就是全量的，丢掉半行不会丢任何状态，而为一个畸形帧把整条推送打断则是纯损失。
 * 但 `onSnapshot` 自己抛出的异常不受这份宽容保护——那是消费方的问题，会被原样上抛。
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
        deliver(line, options.onSnapshot)
      }
    }
  } finally {
    // 放开读取端：从中途退出（消费方抛错、外部中止）时连接可能还活着，不 cancel 就留下一条
    // 没人读的连接。流已经正常结束或已经出错时这一行是空操作，所以它只在中途退出时才起作用。
    void reader.cancel().catch(() => undefined)
  }
}

function deliver(line: string, onSnapshot: (snapshot: LiveRequestSnapshot) => void): void {
  if (line.length === 0) return
  let snapshot: LiveRequestSnapshot
  try {
    snapshot = JSON.parse(line) as LiveRequestSnapshot
  } catch {
    console.warn('[console] dropped a malformed live request frame')
    return
  }
  // 消费方抛错**不属于**畸形帧：把两者放在同一个 try 里，会把「界面渲染崩了」记成
  // 「收到一帧坏数据」，还会把真正的异常吞掉。它照旧往上抛，由调用方决定重连还是收摊。
  onSnapshot(snapshot)
}
