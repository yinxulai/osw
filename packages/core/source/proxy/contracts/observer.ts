import type { HeaderMap } from './headers'
import type { AttemptView, ExchangeView } from './exchange'
import type { UpstreamTarget } from './transport'

/**
 * 观察者：内核里唯一允许「看」报文的地方。
 *
 * 观察者拿到的是只读的交换/尝试投影加字节，不能修改任何东西，也不能改变返回值——
 * 观察者抛错只会丢掉它自己的记录，不会影响转发。
 */
export interface Observer {
  readonly id: string
  onAttemptStart?(exchange: ExchangeView, attempt: AttemptView, target: UpstreamTarget): void
  /** 上游响应头落地。 */
  onUpstreamHead?(exchange: ExchangeView, attempt: AttemptView, status: number, headers: HeaderMap): void
  onUpstreamChunk?(exchange: ExchangeView, attempt: AttemptView, chunk: Buffer): void
  /** 客户端侧实际写出的字节（可能是转换产物，也可能原样）。 */
  onDownstreamChunk?(exchange: ExchangeView, attempt: AttemptView, chunk: Buffer): void
  onAttemptEnd?(exchange: ExchangeView, attempt: AttemptView, outcome: AttemptOutcomeView): void
}

export interface AttemptOutcomeView {
  readonly status: number | null
  readonly durationMilliseconds: number
}
