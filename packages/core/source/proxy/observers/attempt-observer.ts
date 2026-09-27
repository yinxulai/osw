import type { AttemptView, ExchangeView, HeadFrame, HeaderMap, Observer } from '@server/proxy/contracts'
import { serializeChunkSnapshot } from '@server/proxy/adapters/http-response-sink'
import { createUsageTracker, type ExtractedUsage } from './usage'

export interface AttemptObserverOptions {
  exchange: ExchangeView
  attempt: AttemptView
  /** 是否把上游字节留存下来（关掉时只保留原文，用于判定流式与错误分类）。 */
  captureEnabled: boolean
  /** 尝试开始时刻，TTFT 相对它计算。 */
  startedAt: number
}

/**
 * 关闭正文采集时，观察者仍要保留一小段原文供健康度分类和错误归因；它不应随着
 * 长连接无限增长。窗口取尾部，因为上游错误通常在输出末尾给出结论。
 */
export const UNCAPTURED_RAW_BODY_LIMIT_BYTES = 64 * 1024

/**
 * 一次尝试的观察者：把「上游怎么回的」变成可落库的事实。
 *
 * 它是响应侧唯一的字节读者，因此也是替换 `ResponsePipeline` 里那半份观测职责的落点：
 * 用量、TTFT、上游视角正文都从这里出，而出口只负责把字节写出去。
 *
 * 两者对「这份正文该怎么记」共用同一个判断——客户端跳声明的形态是不是 `http-stream`——
 * 因此正文的**形状**始终一致：要么两边都是分块快照，要么两边都是原文。
 *
 * 这里读的是**客户端跳声明的形态**，不是「客户端要增量 **且** 上游以 SSE 回答」的合成量：
 * 后者会把「上游没兑现形态」抹平成「那就当整包记」，而那个状态由执行器显式判定为
 * failover（§1.2）。**上游跳实际是什么形态**仍是独立的一件事，由执行器读响应头得出
 * （`upstreamTransport`），落库时进的是尝试行而不是请求行。
 *
 * 观察者不改任何字节，也不影响转发结果——它抛错只会丢掉自己的记录。
 */
export interface AttemptObserver extends Observer {
  /** 上游响应头投影；尚未收到时为 `null`。 */
  head(): HeadFrame | null
  /** 上游视角正文；客户端跳声明 `http-stream` 时是分块快照，否则是原文。 */
  upstreamBody(): string | null
  /** 原文字节；流式下发时为完整 SSE 文本（与分块快照相对，用于健康度判定）。 */
  rawBody(): string | null
  /** 上游上报的用量。 */
  usage(): ExtractedUsage
  /** 首字节时延；上游没有真实输出时为 `null`。 */
  ttftMilliseconds(): number | null
}

export function createAttemptObserver(options: AttemptObserverOptions): AttemptObserver {
  return new ObserverState(options)
}

class ObserverState implements AttemptObserver {
  readonly id = 'attempt-observer'
  private readonly options: AttemptObserverOptions
  private readonly tracker = createUsageTracker()
  private readonly upstreamChunks: string[] = []
  private headFrame: HeadFrame | null = null
  private raw = ''
  private rawByteLength = 0
  /** 非流式 JSON 的用量只能整包解析；它不参与正文保留，解析完即可释放。 */
  private wholeBody = ''
  private firstOutputAt: number | null = null

  constructor(options: AttemptObserverOptions) {
    this.options = options
  }

  head(): HeadFrame | null {
    return this.headFrame
  }

  upstreamBody(): string | null {
    if (this.expectsStreaming()) return serializeChunkSnapshot(this.upstreamChunks)
    return this.raw || null
  }

  rawBody(): string | null {
    return this.raw || null
  }

  usage(): ExtractedUsage {
    return this.tracker.usage()
  }

  ttftMilliseconds(): number | null {
    return this.firstOutputAt === null ? null : this.firstOutputAt - this.options.startedAt
  }

  onUpstreamHead(_exchange: ExchangeView, _attempt: AttemptView, status: number, headers: HeaderMap): void {
    // 这里拿到的始终是上游原始头：修改器可能已经改写过头帧，但「上游怎么回的」不该被改写。
    this.headFrame = { kind: 'head', status, headers }
  }

  onUpstreamChunk(_exchange: ExchangeView, _attempt: AttemptView, chunk: Buffer): void {
    const text = chunk.toString('utf8')
    this.appendRaw(text)
    if (this.options.captureEnabled) this.upstreamChunks.push(text)
    // 非流式正文在收尾时一次性解析：中途的半截 JSON 解析不出任何东西。
    if (!this.expectsStreaming()) {
      this.wholeBody += text
      return
    }
    if (this.tracker.consumeSseChunk(text)) this.markFirstOutput()
  }

  onAttemptEnd(_exchange: ExchangeView, _attempt: AttemptView): void {
    if (this.expectsStreaming()) {
      if (this.tracker.flush()) this.markFirstOutput()
      return
    }
    this.tracker.consumeJson(this.wholeBody)
    this.wholeBody = ''
  }

  /** 客户端跳声明的形态是不是 `http-stream`。**预期**，与上游实际怎么回的无关。 */
  private expectsStreaming(): boolean {
    return this.options.exchange.transport === 'http-stream'
  }

  private markFirstOutput(): void {
    if (this.firstOutputAt === null) this.firstOutputAt = Date.now()
  }

  private appendRaw(text: string): void {
    this.raw += text
    this.rawByteLength += Buffer.byteLength(text)
    if (this.options.captureEnabled || this.rawByteLength <= UNCAPTURED_RAW_BODY_LIMIT_BYTES) return

    const buffer = Buffer.from(this.raw)
    let start = buffer.length - UNCAPTURED_RAW_BODY_LIMIT_BYTES
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1
    this.raw = buffer.subarray(start).toString('utf8')
    this.rawByteLength = Buffer.byteLength(this.raw)
  }
}
