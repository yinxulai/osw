import type { Frame, FrameSink, HeadFrame, HeaderMap, TransportKind } from '@server/proxy/contracts'
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
   * 客户端跳的传输形态。
   *
   * 它是**预期**，也是出口唯一的交付依据：`http-stream` 才边收边发，否则攒完再发。
   * 上游回了一个非 SSE 的 2xx 时，执行器已经在上游响应头落地的那一刻把这次尝试判成
   * failover（见 `attempt-executor.ts`），因此出口不需要、也不允许再去读上游响应头
   * 来重新回答「这次到底该不该边收边发」（§1.2）。
   */
  transport: TransportKind
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
  /** 客户端视角已写出的正文；从未写出时为 `null`。 */
  downstreamBody(): string | null
  /** 已写出的部分正文；未采集或尚未写出任何内容时为 `null`。 */
  partialDownstreamBody(): string | null
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
      if (this.options.transport === 'http-stream') this.startDownstream()
      return
    }
    if (frame.kind === 'data') {
      if (this.options.transport !== 'http-stream') {
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

  downstreamBody(): string | null {
    if (this.options.transport === 'http-stream') {
      return serializeChunkSnapshot(this.captured.map(chunk => chunk.toString('utf8')))
    }
    return this.captured.length > 0 ? Buffer.concat(this.captured).toString('utf8') : this.bufferedWritten
  }

  partialDownstreamBody(): string | null {
    return this.captured.length > 0 ? Buffer.concat(this.captured).toString('utf8') : null
  }

  failure(): Error | null {
    return this.failed
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
    if (this.options.transport === 'http-stream') {
      if (!sink.writableEnded) sink.end()
      return
    }
    const body = Buffer.concat(this.buffered)
    // 已写出的正文与响应是否还能写无关：客户端视角的记录不该因为连接已关闭而消失。
    this.bufferedWritten = body.length > 0 ? body.toString('utf8') : null
    if (sink.writableEnded) return
    if (!sink.headersSent) sink.start(head.status, head.headers)
    if (body.length === 0) {
      sink.end()
      return
    }
    const pending = this.writeDownstream(body)
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
