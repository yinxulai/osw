import type { AttemptView, ExchangeView, Observer } from '@server/proxy/contracts'
import type { LiveAttemptHandle } from './live-request-store'
import { createUsageTracker } from '@server/proxy/observers/usage'

export interface LiveAttemptObserverOptions {
  /** 这次尝试在台账里的写口；台账里没有这个请求（内部执行）时为 `null`，观察者整体空转。 */
  handle: LiveAttemptHandle | null
  /** 这次尝试是不是流式形态；决定字节该按 SSE 逐事件读，还是当成整包等收尾再读。 */
  streaming: boolean
  /** 尝试开始时刻，TTFT 相对它计算。 */
  startedAt: number
  /**
   * 正文的第一个字节真的到了的那一刻。
   *
   * 传出去而不是就地写进尝试行，是因为「上游开始吐字了」是**请求级**的事实：
   * 请求的阶段要从「已回头、等首字节」变成「正在交付」，而阶段在请求写口上不在尝试写口上。
   * 观察者只负责发现这一刻，改写阶段归执行器——它才是那个同时拿着两个写口的人。
   */
  onFirstByte?: (ttftMilliseconds: number) => void
}

/**
 * 把「字节正在流过」变成台账里可读的数据流统计。
 *
 * 与 `AttemptObserver` 的分工：那个负责产出**可落库的事实**（用量、上游正文、健康度判定），
 * 这个只产出**此刻的进度**（收了多少字节、分了几块、首字多久、已经读到多少输出 Token）。
 * 两者都在观察同一条流，谁也不依赖谁——其中一个抛错只会丢掉自己那一条记录。
 *
 * 它刻意不碰状态码与上游形态：那两件事由执行器在 `onHead` 里写，因为「这次尝试要不要交付」
 * 的判断也在那里，事实与判断必须落在同一处，否则会出现「状态码说 200、交付判定说 failover」
 * 这种自相矛盾的快照。
 */
export function createLiveAttemptObserver(options: LiveAttemptObserverOptions): Observer {
  return new LiveAttemptObserver(options)
}

class LiveAttemptObserver implements Observer {
  readonly id = 'live-request-observer'
  private readonly options: LiveAttemptObserverOptions
  private readonly tracker = createUsageTracker()
  private firstOutputAt: number | null = null
  /** 非流式响应没有可逐块读的用量，收尾时一次性解析原文。 */
  private raw = ''

  constructor(options: LiveAttemptObserverOptions) {
    this.options = options
  }

  onUpstreamChunk(_exchange: ExchangeView, _attempt: AttemptView, chunk: Buffer): void {
    const handle = this.options.handle
    if (handle === null) return
    const text = chunk.toString('utf8')
    // 原文交给台账，截断与条数上限都在那边做（内存边界只能有一个定义处）。
    handle.addUpstreamChunk(chunk.length, text)
    if (!this.options.streaming) {
      // 整包响应在收尾时才能解析：中途的半截 JSON 解析不出任何东西。
      this.raw += text
      return
    }
    if (this.tracker.consumeSseChunk(text)) this.markFirstOutput(handle)
    this.publishUsage(handle)
  }

  onDownstreamChunk(_exchange: ExchangeView, _attempt: AttemptView, chunk: Buffer): void {
    this.options.handle?.addDownstreamBytes(chunk.length)
  }

  onAttemptEnd(_exchange: ExchangeView, _attempt: AttemptView): void {
    const handle = this.options.handle
    if (handle === null) return
    if (this.options.streaming) {
      if (this.tracker.flush()) this.markFirstOutput(handle)
      this.publishUsage(handle)
      return
    }
    // 整包响应没有「中途」：正文与首字同时到达，所以首字就在收尾这一刻打点。
    // 不打点的话，非流式请求的首字延迟会永远停在「等待首字节」，而这明明是已经收到的。
    if (this.tracker.consumeJson(this.raw)) this.markFirstOutput(handle)
    this.publishUsage(handle)
  }

  /** 首字时刻只在第一次真实输出时打点；后续再多的字节都不该改写它。 */
  private markFirstOutput(handle: LiveAttemptHandle): void {
    if (this.firstOutputAt !== null) return
    this.firstOutputAt = Date.now()
    const ttftMilliseconds = this.firstOutputAt - this.options.startedAt
    handle.patch({ ttftMilliseconds })
    this.options.onFirstByte?.(ttftMilliseconds)
  }

  private publishUsage(handle: LiveAttemptHandle): void {
    const { inputTokens, outputTokens } = this.tracker.usage()
    if (inputTokens !== null) handle.patch({ inputTokens })
    if (outputTokens !== null) handle.patch({ outputTokens })
  }
}
