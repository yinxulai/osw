import type { Protocol, TransportKind } from '@common/schemas'
import type { BodyDeliveryShape } from './delivery'
import type { Frame, HeadFrame } from './frame'
import type { HeaderMap } from './headers'
import type { AttemptView, ExchangeView } from './exchange'

/** 修改器作用的方向。 */
export type ModifierDirection = 'request' | 'response'

/**
 * 修改器需要看到的粒度。
 * - `buffered`：拿到完整体（模型改写、认证注入、转换请求体）
 * - `frame`：逐帧（SSE 转换、逐块观测）
 * - `skip`：本次交换里不参与。与「`match` 返回 false」的区别是声明性的：这里说的是
 *   「这个修改器在某种交换形态下没有意义」，而 `match` 说的是「这一条不满足条件」。
 *   两个管道都只筛自己那两种粒度，因此不加它也能跑，但没有它就只能用 `match` 回一个恒 
 *   `false` 来表达「不适用」，那会让「为什么没生效」看起来像配置问题。
 */
export type ModifierFrameMode = 'buffered' | 'frame' | 'skip'

/** 缓冲区载荷。`headers` 可原地改写，返回 null 表示丢弃该次交换。 */
export interface BufferedPayload {
  body: Buffer
  headers: HeaderMap
}

export interface ModifierContext {
  readonly exchange: ExchangeView
  readonly attempt: AttemptView
  readonly direction: ModifierDirection
  readonly clientProtocol: Protocol
  readonly upstreamProtocol: Protocol
  /**
   * 上游响应头投影；尚未收到响应头时为 `null`。
   *
   * 这里始终是上游的原始头，不会被任何修改器改写。它的用途只有两个：
   * 选**解析器**（手里这堆字节是 SSE 还是整包 JSON），以及**校验预期**（客户端要的传输
   * 形态到底兑现没有）。它不用来回答「该做什么」——那个问题的答案在
   * `exchange.transport`（预期）里，早在上游回话之前就定了（见 `apps/docs/specs/proxy-engine.md` §1.2）。
   */
  readonly upstreamHead: HeadFrame | null
}

/**
 * 修改器声明的适用范围。
 *
 * **声明式**：内核按它排除修改器，修改器自己不必再判断传输形态——这正是
 * 「hooks 基于 protocol 与 transport 处理数据，且不需要自己去判断」的落地方式。
 *
 * 它与 `match` 的分工：`scope` 说的是「这种形态下根本没有它能做的事」（静态能力，
 * 结论要进日志：本规则在本形态下未生效），`match` 说的是「这一条请求不满足它的条件」。
 */
export interface ModifierScope {
  /** **客户端跳**的传输形态。省略表示不限。 */
  readonly transports?: readonly TransportKind[]
  /**
   * 本次交付的正文形态（见 `BodyDeliveryShape`）。省略表示不限。
   *
   * 「这种形态下没有它能做的事」有时候不取决于哪一跳、而取决于正文怎么发出去：
   * 响应改写规则在一整份 JSON 上按路径取值，逐块交付时手里只有一段段 SSE 文本，
   * 因此它声明 `['whole']`。用 `transports` 表达同一件事会失真——同一档传输上
   * 正文的形态由 `bodyDeliveryShape` 统一决定，两处各判一次就会出现两个答案。
   */
  readonly shapes?: readonly BodyDeliveryShape[]
}

/**
 * 修改器：内核里唯一允许解析、改写报文的地方。
 *
 * 内核按 `direction` 收集匹配的修改器，`buffered` 与 `frame` 分两段执行：
 * 缓冲区修改器全部跑完才发出去（顺序由 `order` 决定），帧修改器按 `order` 串成管道。
 * 同一个修改器可以只实现一个方向、也可以两个都实现（例如协议转换）。
 */
export interface Modifier {
  readonly id: string
  /** 越小越先执行；同值时按注册顺序。 */
  readonly order: number
  readonly direction: ModifierDirection
  readonly frameMode: ModifierFrameMode
  /** 声明适用范围；内核在调 `match` 之前先按它排除。省略表示本方向、本粒度下全适用。 */
  readonly scope?: ModifierScope
  match(context: ModifierContext): boolean
  applyBuffered?(context: ModifierContext, payload: BufferedPayload): BufferedPayload | null | Promise<BufferedPayload | null>
  applyFrame?(context: ModifierContext, frame: Frame): Frame | readonly Frame[] | null | Promise<Frame | readonly Frame[] | null>
}
