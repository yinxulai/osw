import type { OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { ClientDelivery, ClientResponseHead } from '@server/proxy/contracts'

/**
 * 代理自己生成的错误响应的正文。
 *
 * 「代理自己拒掉一次请求」有四个出口（入口拒绝、出口的 `fail`、运行时的兜底回写），
 * 但它们交给客户端的必须是同一份报文：形状只有一个来源，客户端才不会因为走的是哪条
 * 拒绝路径而看到不同的错误结构。
 */
export function proxyErrorBody(errorCode: string, errorMessage: string): string {
  return JSON.stringify({ success: false, errorCode, errorMessage })
}

/** 代理自己生成的错误响应必定是 JSON：这是它唯一需要带的头。 */
export const PROXY_ERROR_HEADERS = { 'content-type': 'application/json' } as const

/** 响应写出口的最小形状：只要能把字符串写出去并收尾，就能作为出口（含测试替身）。 */
export interface ResponseSink {
  readonly writableEnded: boolean
  /**
   * 写出一块正文。
   *
   * 返回值是背压信号：`false` 表示这块正文只是进了内核缓冲区、客户端还没收走，
   * 调用方应当等 `drained()` 之后再继续写。不表达背压的实现可以返回 `void`
   * （内存缓冲与测试替身没有这个状态）。
   */
  write(chunk: string | Uint8Array): boolean | void
  /** 等到内核缓冲区排空；只在上一次 `write` 返回 `false` 之后调用。 */
  drained?(): Promise<void>
  end(): void
}

/**
 * 代理响应出口。
 *
 * 只负责「把字节交给客户端」，不认识协议、不认识帧、不解析正文：
 * 协议差异在修改器里抹平，字节搬运在中继里完成，这里只做最后一步落地。
 *
 * 它同时是「客户端到底收到了什么」这份审计事实的唯一来源：{@link delivery} 与
 * {@link headers} 都由它自己记账，**不回读**宿主（`ServerResponse`）的内部状态。
 * 理由是回读依赖一个宿主没有承诺过的契约：`writeHead(status, headers)` 把头对象当第二个
 * 参数交出去之后，Node 的 `getHeaders()` 只剩一个空对象——头确实发出去了，却读不回来。
 * 于是「返回客户端的响应」在日志里只剩正文、响应头恒为 `null`。出口自己记账，
 * 这类依赖就整体不存在了。
 */
export interface ProxyResponse extends ResponseSink {
  readonly headersSent: boolean
  readonly destroyed: boolean
  start(statusCode: number, headers: OutgoingHttpHeaders): void
  /**
   * 写出一份由代理自己生成的错误响应，并交回它的交付事实。
   *
   * 返回值就是 {@link ClientDelivery}：它已经是一份完整、确定的交付（代理在本进程里
   * 一次成形），因此调用方不需要自己拼状态码、自己再取一遍头。
   */
  fail(statusCode: number, errorCode: string, errorMessage: string): ClientDelivery
  destroy(error: Error): void
  /** 已写出的响应头；未写出时为 `{}`，与「还没发过头」是同一件事。 */
  headers(): OutgoingHttpHeaders
  /**
   * 已经交给客户端的响应头与状态码；还没发过任何头时为 `null`。
   *
   * 与分两次读（先问状态码、再问响应头）相比，它是一个原子快照：两者必须同时成立或
   * 同时为空，拆开读等于允许「有头没状态码」。
   */
  sentHead(): ClientResponseHead | null
}

export class NodeProxyResponse implements ProxyResponse {
  /**
   * 已经交给客户端的响应头。
   *
   * 这是**记账**而不是缓存：它在 {@link start} / {@link fail} 里写入，之后不再变化。
   * 不回读 `response.getHeaders()` 的理由见 {@link ProxyResponse}。
   */
  private sentHeaders: OutgoingHttpHeaders = {}
  private sentStatusCode: number | null = null

  constructor(private readonly response: ServerResponse) {}

  get writableEnded(): boolean { return this.response.writableEnded }
  /** 自己的账本，不看 `response.headersSent`：两者表达同一件事，但后者只在真写出头之后才为真。 */
  get headersSent(): boolean { return this.sentStatusCode !== null }
  get destroyed(): boolean { return this.response.destroyed }

  /**
   * 发出响应头。
   *
   * 头先逐条 `setHeader` 登记、再单独 `writeHead(statusCode)`；**不能**把头对象当第二个参数
   * 交给 `writeHead`——那之后 `getHeaders()` 就再也答不出「客户端收到了哪些头」（见
   * {@link ProxyResponse}）。分两步走时 Node 的账本依旧可读，但出口已经不依赖它了：
   * {@link sentHeaders} 记的是我们交出去的那一份，与宿主版本无关。
   *
   * 空值跳过：`OutgoingHttpHeaders` 允许 `undefined`，而 `setHeader` 不接受它。
   */
  start(statusCode: number, headers: OutgoingHttpHeaders): void {
    if (this.headersSent) return
    const sent: OutgoingHttpHeaders = {}
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue
      sent[name] = value
      this.response.setHeader(name, value)
    }
    this.sentHeaders = sent
    this.sentStatusCode = statusCode
    this.response.writeHead(statusCode)
  }

  write(chunk: string | Uint8Array): boolean { return this.response.write(chunk) }

  /**
   * 等客户端把内核缓冲区读空。
   *
   * `close` / `error` 也要收尾：客户端断开的连接永远不会再发 `drain`，
   * 只等它会把整条管道挂在一次已经结束的请求上。
   */
  drained(): Promise<void> {
    return new Promise(resolve => {
      const finish = () => {
        this.response.off('drain', finish)
        this.response.off('close', finish)
        this.response.off('error', finish)
        resolve()
      }
      this.response.once('drain', finish)
      this.response.once('close', finish)
      this.response.once('error', finish)
    })
  }

  end(): void { this.response.end() }
  destroy(error: Error): void { this.response.destroy(error) }
  headers(): OutgoingHttpHeaders { return this.sentHeaders }
  sentHead(): ClientResponseHead | null {
    return this.sentStatusCode === null ? null : { statusCode: this.sentStatusCode, headers: this.sentHeaders }
  }

  /**
   * 本地失败响应。
   *
   * 与 {@link start} 共用同一个记账路径而不是各写一遍：它同样是一份「要发给客户端的响应」，
   * 客户端视角的记录不该因为它由代理生成（而不是转发自上游）就缺失。
   *
   * 返回的交付必定是完整的：正文在本进程里一次成形成、一次写出，不存在只搬了一半的情形。
   */
  fail(statusCode: number, errorCode: string, errorMessage: string): ClientDelivery {
    const body = proxyErrorBody(errorCode, errorMessage)
    this.start(statusCode, PROXY_ERROR_HEADERS)
    this.response.end(body)
    return this.delivered(body)
  }
  /** 把刚写出的正文与当时的出口事实拼成交付快照。 */
  private delivered(body: string): ClientDelivery {
    const head = this.sentHead()
    // 头一旦发出就改不回来了：若此前已经发过，`start` 是空操作，这里回报的就是
    // 「客户端当初收到的那个状态码与头」，而不是这次想发的那个——否则审计记录
    // 会与客户端实际收到的东西互相矛盾。
    if (!head) throw new Error('delivery head is missing right after start()')
    return { ...head, body, complete: true }
  }
}

export class BufferedProxyResponse implements ProxyResponse {
  private chunks: Uint8Array[] = []
  private responseHeaders: OutgoingHttpHeaders = {}
  private status = 0
  private ended = false
  private failure: Error | null = null

  get writableEnded(): boolean { return this.ended }
  get headersSent(): boolean { return this.status !== 0 }
  get destroyed(): boolean { return this.failure !== null }
  get statusCode(): number { return this.status }
  get body(): string { return Buffer.concat(this.chunks).toString('utf8') }
  get failureMessage(): string | undefined { return this.failure?.message }

  start(statusCode: number, headers: OutgoingHttpHeaders): void {
    if (this.headersSent) return
    this.status = statusCode
    this.responseHeaders = { ...headers }
  }

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Uint8Array.from(chunk))
    return true
  }
  end(): void { this.ended = true }
  destroy(error: Error): void { this.failure = error; this.ended = true }
  headers(): OutgoingHttpHeaders { return this.responseHeaders }
  sentHead(): ClientResponseHead | null {
    return this.headersSent ? { statusCode: this.status, headers: this.responseHeaders } : null
  }

  fail(statusCode: number, errorCode: string, errorMessage: string): ClientDelivery {
    const body = proxyErrorBody(errorCode, errorMessage)
    this.start(statusCode, PROXY_ERROR_HEADERS)
    this.write(body)
    this.end()
    // 与 `NodeProxyResponse` 同一套语义：头已经发过就改不回来了，交付事实照实回报。
    const head = this.sentHead()
    if (!head) throw new Error('delivery head is missing right after start()')
    return { ...head, body, complete: true }
  }
}
