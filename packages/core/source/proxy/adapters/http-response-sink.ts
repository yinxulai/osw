import type { BodyDeliveryShape, ClientDelivery, Frame, FrameSink, HeadFrame, HeaderMap } from '@server/proxy/contracts'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'

/**
 * 上游响应的分帧格式：手里这堆字节是 SSE 还是整包 JSON。
 *
 * 这是**事实**（上游怎么回的），与客户端的**预期**（`exchange.transport`）是两件事，因此读它
 * 之前先想清楚要哪一半（§1.2）：选解析器用它，决定交付行为用预期。
 */
export function isEventStreamResponse(headers: HeaderMap): boolean {
  return String(headers['content-type'] ?? '').includes('text/event-stream')
}

/**
 * 分块快照的**落库格式**。
 *
 * 名字里不带「流式」二字：这个函数只回答「分块列表怎么写进库里」，与「字节怎么发出去」无关。
 * 流式正文不存原文而存分块列表，是为了复现「逐块到达」的时序。
 *
 * 出口与观察者共用这一份定义：两边都得把「收到的字节」表示成同一个形状，
 * 否则同一次请求的上游视角与客户端视角会长得不一样。
 */
export function serializeChunkSnapshot(chunks: readonly string[]): string {
  return JSON.stringify({ schemaVersion: 1, chunks })
}

export interface HttpResponseSinkOptions {
  response: ProxyResponse
  /**
   * 这次交付的正文形态（见 `BodyDeliveryShape`）。
   *
   * 它是出口唯一的交付依据：`incremental` 才边收边发，否则攒完再发。取这个值而不是
   * 自己再判一次客户端跳的 `transport`，是为了与响应修改器共用同一个判定——两处各判一次
   * 就会出现两个答案，而两个答案不一致时 `content-length` 与实际写出的字节数不符。
   *
   * 上游回了一个与预期不符的形态时，执行器已经在上游响应头落地的那一刻把这次尝试判成
   * failover（见 `attempt-executor.ts`），因此出口不需要、也不允许再去读上游响应头
   * 来重新回答「这次到底该不该边收边发」。
   */
  mode: BodyDeliveryShape
  /** 是否记录写出的字节。关闭时只保留缓冲分支的兜底正文。 */
  captureEnabled: boolean
  /**
   * 一块正文已经交给客户端出口之后调用。
   *
   * 它不从帧管道触发：修改器产出一帧不代表出口接受它，更不代表被放弃的尝试真的写出过字节。
   */
  onDeliveredChunk?: (chunk: Buffer) => void
}

/**
 * 「客户端到底收到了什么」的原子快照。见 `ClientDelivery`：四个字段同进同出，
 * 拆开读等于允许它们描不同的时刻。
 */
export type { ClientDelivery }

/**
 * 帧出口：把内核吐出的帧写到 HTTP 响应上。
 *
 * 这是内核与 `ProxyResponse` 的唯一接触面，也是「出口不认识协议」的落点：
 * - 缓冲分支把数据帧攒起来，在 `end` 时一次性写完（内容可能已被修改器改写，
 *   因此 `content-length` 由头修改器提前删掉，交给 Node 重新分帧）；
 * - 流式分支在头帧落地时就 `start()`，之后逐帧写出，让首字节尽快到达客户端；
 * - `discard()` 用于 failover：这次尝试的响应一个字节都不该给客户端，但帧仍然照常流过
 *   观察者，日志里照样能看到上游返回了什么。
 */
export interface HttpResponseSink extends FrameSink {
  /** 放弃交付（failover 提前放弃）：之后不再写任何字节。 */
  discard(): void
  /**
   * 客户端视角的交付事实；从未向客户端写出响应头时为 `null`。
   *
   * 出口是唯一同时知道「状态码、响应头、正文、完整与否」的地方，因此这个快照只能由它给出。
   * 让调用方自己拼（状态码从执行器取、正文从出口取）会把一件事实拆到两个不再同步的源上。
   */
  delivery(): ClientDelivery | null
  /** 交付过程中观察到的失败。 */
  failure(): Error | null
}

export function createHttpResponseSink(options: HttpResponseSinkOptions): HttpResponseSink {
  return new HttpFrameSink(options)
}

class HttpFrameSink implements HttpResponseSink {
  private readonly options: HttpResponseSinkOptions
  private head: HeadFrame | null = null
  private discarded = false
  private finished = false
  private failed: Error | null = null
  private readonly captured: Buffer[] = []
  private readonly buffered: Buffer[] = []
  private bufferedWritten: string | null = null
  /** 见 `ClientDelivery.complete`：收尾走完了没有，只有出口自己知道。 */
  private complete = false

  constructor(options: HttpResponseSinkOptions) {
    this.options = options
  }

  get closed(): boolean {
    return this.finished
  }

  async write(frame: Frame): Promise<void> {
    if (this.finished || this.discarded) return
    if (frame.kind === 'head') {
      this.head = frame
      if (this.incremental) this.startDownstream()
      return
    }
    if (frame.kind === 'data') {
      if (!this.incremental) {
        this.buffered.push(frame.body)
        return
      }
      const pending = this.writeDownstream(frame.body)
      if (pending) await pending
      return
    }
    if (frame.kind === 'error') {
      // 交付中途失败不在这里收尾：向上游报告失败、由执行器决定是销毁响应还是 failover。
      this.failed = frame.error
      this.finished = true
      return
    }
    // 没有背压时收尾是**同步**完成的：出口的调用方在同一轮里就能看到响应已结束。
    const pending = this.finish()
    if (pending) await pending
  }

  discard(): void {
    this.discarded = true
  }

  /**
   * 客户端视角的交付事实。
   *
   * 响应头从出口的账本取（不是从帧里取）：帧里的头是**打算**发出去的那一份，账本里
   * 才是真发出去的那一份，两者在「响应已结束、头没来得及发」时会不一样。
   */
  delivery(): ClientDelivery | null {
    const sent = this.options.response.sentHead()
    if (!sent) return null
    return {
      statusCode: sent.statusCode,
      headers: sent.headers,
      body: this.deliveredBody(),
      complete: this.complete,
    }
  }

  failure(): Error | null {
    return this.failed
  }

  get incremental(): boolean {
    return this.options.mode === 'incremental'
  }

  /**
   * 已交付的正文。
   *
   * 整包交付记原文，增量交付记分块列表——两者各自只有一个来源，不互相兜底：
   * - 整包交付时正文只有一份（收尾时写出），因此取 {@link bufferedWritten}；
   * - 增量交付时正文是逐块写出的，只有**记录过**才有快照；关掉采集就是 `null`
   *   （**没有记录**），而不是一个「记录了零块」的空快照——后者会把一次真实交付记成空正文。
   *
   * 没写出过正文时两者都是 `null`，这与「这次交付没有正文」是同一件事。
   */
  private deliveredBody(): string | null {
    if (!this.incremental) return this.bufferedWritten
    if (!this.options.captureEnabled) return null
    return serializeChunkSnapshot(this.captured.map(chunk => chunk.toString('utf8')))
  }

  private startDownstream(): void {
    const sink = this.options.response
    if (sink.writableEnded || sink.headersSent || !this.head) return
    sink.start(this.head.status, this.head.headers)
  }

  /**
   * 收尾。只有真的撞上背压时才返回 Promise（见 `writeDownstream`）：
   * 平白多一次微任务会让「写完了没有」在同一个 tick 里问不出答案。
   */
  private finish(): void | Promise<void> {
    this.finished = true
    const head = this.head
    if (!head || this.discarded) return
    const sink = this.options.response
    // 增量交付时数据帧已经逐条写出去了，收尾只需关掉响应。
    if (this.incremental) {
      if (!sink.writableEnded) sink.end()
      this.complete = true
      return
    }
    const body = Buffer.concat(this.buffered)
    // 响应已经关掉了就一个字节都没写出去，因此这里不能记正文：记了就会让「客户端视角」
    // 声称收到过一份从未发出的正文。这与 `writeDownstream` 里同一处判断必须一致。
    if (sink.writableEnded) return
    if (!sink.headersSent) sink.start(head.status, head.headers)
    if (body.length === 0) {
      sink.end()
      this.complete = true
      return
    }
    // 整包交付下采集关了也要留正文：客户端视角的记录表达的是「这次交付发了什么」，
    // 它由整包交付本身决定，不随采集开关变化。
    this.bufferedWritten = body.toString('utf8')
    const pending = this.writeDownstream(body)
    // 收尾是否完整在上游那边（`body` 已经全部交给出口了）就已经确定，因此先标上再等背压：
    // 否则一个慢客户端会把「完整的一份正文」记成半截。
    this.complete = true
    if (!pending) {
      sink.end()
      return
    }
    return pending.then(() => {
      if (!sink.writableEnded) sink.end()
    })
  }

  /**
   * 写一块正文；客户端收不走时返回「等它收得动」那件事，否则返回 undefined（同步完成）。
   *
   * 客户端收不走时必须等：继续把上游的字节往内核缓冲区里塞，等于把「客户端有多慢」
   * 换算成「我们能占多少内存」。等待期间管道不再拉下一帧，上游随之被暂停（`FrameQueue`）。
   */
  private writeDownstream(chunk: Buffer): void | Promise<void> {
    const sink = this.options.response
    // 已经收尾的响应不能再写；此时连「客户端视角」也不该记账，因为它并没有收到。
    if (sink.writableEnded) return
    if (this.options.captureEnabled) this.captured.push(chunk)
    const accepted = sink.write(chunk)
    const notify = () => this.options.onDeliveredChunk?.(chunk)
    if (accepted === false && sink.drained) return sink.drained().then(notify)
    notify()
    return undefined
  }
}
