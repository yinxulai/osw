import { openStream } from './client'

/**
 * NDJSON 流的分帧与装包骨架。
 *
 * 「进行中的请求」「实时指标」两条推送流，以及渠道诊断那条**会结束**的运行流，共用这一份——
 * 攒缓冲、切行、半行容错、把一行翻成业务消息、放开读取端，这些是**传输**的事，与「这一行
 * 是什么消息」无关，没必要各写一遍。判据（`isMessage`）由调用方给：协议边界各流不同。
 *
 * 半行是真实存在的（连接会在任意一个字节上被掐断），因此解析失败的行直接丢掉：推送流的下一条
 * `snapshot` 本来就是全量的，丢掉半行不会留下不一致；而为一条残帧把整条流打断则是纯损失。
 * 但 `onMessage` 自己抛出的异常不受这份宽容保护——那是消费方的问题，会被原样上抛。
 *
 * 结束即返回（读到流尾、正常断开与 `signal` 中止都算），重连交给调用方——退避策略属于
 * 「谁在用它」，不属于「怎么读它」。
 */
export async function readNdjsonStream<T>(path: string, body: unknown, signal: AbortSignal | undefined, parse: (line: string) => T | null, onMessage: (message: T) => void): Promise<void> {
  const stream = await openStream(path, body, { signal })
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
        const message = parse(line)
        if (message !== null) onMessage(message)
      }
    }
  } finally {
    // 放开读取端：从中途退出（消费方抛错、外部中止）时连接可能还活着，不 cancel 就留下一条
    // 没人读的连接。流已经正常结束或已经出错时这一行是空操作，所以它只在中途退出时才起作用。
    void reader.cancel().catch(() => undefined)
  }
}

/**
 * 把一行原文翻成业务消息：先 JSON 解析，再用判据守住线路协议边界。
 *
 * 只守住协议边界，不逐字段校验业务 payload：这个服务与界面同版本发布、只监听回环地址；
 * 字段可信度沿用其他管理 API 的约定。这里负责拒绝旧协议或未知消息，避免它们被静默解释成
 * 一次状态替换。消费方抛错**不属于**畸形帧，它照旧往上抛，由调用方决定重连还是收摊。
 */
export function parseStreamLine<T>(line: string, isMessage: (value: unknown) => value is T, label: string): T | null {
  if (line.length === 0) return null
  let message: unknown
  try {
    message = JSON.parse(line) as unknown
  } catch {
    console.warn(`[console] dropped a malformed ${label} frame`)
    return null
  }
  if (!isMessage(message)) {
    console.warn(`[console] dropped an unsupported ${label} stream message`)
    return null
  }
  return message
}
