import type { OutgoingHttpHeaders } from 'node:http'
import type { TransportKind } from '@common/schemas'

/**
 * 一次尝试的交付决策。
 *
 * 决策只有三种合法状态：尚未收到响应头、允许交付、放弃交付。把状态写成判别联合而不是
 * 两个独立布尔值，避免出现「不可交付但仍标记成功」这类无法解释的组合。
 */
export type DeliveryDecision =
  | { readonly kind: 'pending' }
  | { readonly kind: 'deliver', readonly successful: boolean }
  | { readonly kind: 'discard', readonly reason: 'status' | 'transport-mismatch' }

/** 修改器在响应头到达后读取、执行器在同一个对象上写入的决策槽。 */
export interface DeliveryDecisionRef {
  decision: DeliveryDecision
}

export function createDeliveryDecisionRef(): DeliveryDecisionRef {
  return { decision: { kind: 'pending' } }
}

/**
 * 这次交付的正文是一整块发出去，还是逐块发出去。
 *
 * 它是 `TransportKind` 的函数，也是**唯一**同时被响应出口与响应修改器读到的一根轴：
 * 出口按它选「边收边发」还是「攒完再发」；响应修改器按它回答「手里有没有一整份正文可改」。
 *
 * 之所以要给它一个名字，是因为下游有两处**必须**得到同一个答案，而它们此前各说各的：
 * 出口判 `transport === 'http-stream'`，改写规则声明 `scope.transports: ['http']`。
 * 两式在今天的取值域里恰好等价，那是巧合——一旦多一种形态（或 `websocket` 落地），
 * 两处就会分叉；而分叉的后果是 `content-length` 与实际写出的字节数不符，
 * 客户端以连接层错误直接断开（见 `response-modifiers.ts` 的 `downstream-head`）。
 */
export type BodyDeliveryShape = 'whole' | 'incremental'

export function bodyDeliveryShape(transport: TransportKind): BodyDeliveryShape {
  return transport === 'http-stream' ? 'incremental' : 'whole'
}

/**
 * 客户端视角的响应头事实：状态码 + **真正交出去**的那一份响应头。
 *
 * 「真正交出去」是硬约束：它不能是「打算发出去的头」（帧里的那一份），也不能是
 * 「上游返回的头」。两者在响应头发出前后会不一样，而日志记的是已发生的事。
 */
export interface ClientResponseHead {
  readonly statusCode: number
  readonly headers: OutgoingHttpHeaders
}

/**
 * 客户端视角的一份完整交付快照，也是「写入客户端正文」的唯一入参。
 *
 * 四个字段必须来自同一次观察、同同一个时点：状态码与响应头是「已经交出去」的那一份，
 * 正文是已写出的那一段，`complete` 是收尾跑完了没有。分两次问（先问头、再问正文）
 * 就是在允许它们描不同的时刻，而落库只有一次。
 *
 * 出口是唯一能给出这个快照的地方：它自己写每一块字节、自己收尾，因此也只有它知道
 * 「收尾到底跑完了没有」——上游中途断流、客户端提前关流都只在这里看得见。
 */
export interface ClientDelivery extends ClientResponseHead {
  /** 已交付的正文；从未写出时为 `null`。`complete` 为假时它是已写出的那一段。 */
  readonly body: string | null
  /**
   * 这次交付是否完整走到了收尾。
   *
   * 为假表示正文只搬了一部分就断了。详情页据此说明这份正文不完整，而不是把它当完整采集展示。
   */
  readonly complete: boolean
}
