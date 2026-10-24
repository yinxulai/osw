import type { TransportKind } from '@common/schemas'
import type { HeaderMap } from './headers'
import type { RouteMatcher } from './route-matcher'

/** 请求体的封装种类。内核不解析 body，只有封装描述会。 */
export type ProtocolBodyKind = 'json' | 'binary'

export interface EnvelopeInput {
  readonly headers: HeaderMap
  readonly body: Buffer
  /** 请求目标。入口处有完整 URL；适配器阶段可能只有路径，此时为 `null`。 */
  readonly url: URL | null
}

export interface EnvelopeWriteResult {
  readonly body: Buffer
  readonly url: URL | null
}

/**
 * 读出模型名的结果。失败时带原因，因为原因会原样成为回给客户端的错误文案，
 * 不能由调用方重新猜一遍。
 */
export type ProtocolModelReadResult =
  | { readonly ok: true, readonly model: string }
  | { readonly ok: false, readonly reason: string }

/**
 * 封装描述：一种协议在一个接口上「模型名 / 流式开关 / 响应封装」的读写规则。
 *
 * 这是唯一允许解析请求体的声明位置。内核、执行器、路由都不解析 body：
 * 它们问封装描述。于是「模型名写在 JSON 字段里」还是「写在 URL 路径里」
 * 变成封装描述的实现细节，而不是内核里的分支。
 */
export interface ProtocolEnvelope {
  readonly body: ProtocolBodyKind
  /** 由协议声明的保护字段：这些字段属于传输形态/协议封装，不允许被通用改写规则改动。 */
  readonly deliveryModeFields: readonly string[]
  /** 读出请求里的模型名；没有模型字段时返回失败原因。 */
  readModel(input: EnvelopeInput): ProtocolModelReadResult
  /** 写入模型名。允许同时改写 URL（路径携带模型的协议）。 */
  writeModel(input: EnvelopeInput, modelName: string): EnvelopeWriteResult
  /**
   * 本次请求在客户端跳的传输形态。
   *
   * 返回**轴上的取值**而不是布尔量：调用方把它当作请求级事实直接往下传，
   * 不需要两处各自把 `true` 翻译成 `'http-stream'`（也就不会有两处翻得不一样）。
   *
   * 上游是否真的逐块返回不在这里：那是响应头的事实，与请求封装无关。
   */
  resolveTransport(input: EnvelopeInput): TransportKind
}

/**
 * 接口声明：一个协议对外暴露的一个入口。
 *
 * 新增接口 = 新增一个 `ProtocolEndpointSpec`，不需要改动路径检测、传输形态判定或任何调用方。
 */
export interface ProtocolEndpointSpec {
  readonly id: string
  readonly match: readonly RouteMatcher[]
  /**
   * 该接口的请求封装。
   *
   * 一对一：入口在解析请求体之前就要选中它，而一个接口在客户端跳上只会收到一种形态
   * 的请求（要么一问一答，要么 SSE）—— 形态的差别在响应体怎么分帧，不在请求封装。
   * 真需要两种封装时就是两个接口，`match` 会把它们区分开。
   */
  readonly envelope: ProtocolEnvelope
}
