import type { IncomingHttpHeaders } from 'node:http'
import type { Protocol, RequestAttribute, TransportKind } from '@common/schemas'

export interface RequestContext {
  readonly requestId: string
  readonly logicalModelId: string
  readonly clientProtocol: Protocol
  /**
   * **客户端跳**的传输形态。**事实**：入口按接口封装描述解析出来，一个请求只解析一次。
   *
   * 与 `clientProtocol` 并列而不是合并：`clientProtocol` 决定「报文怎么读」，
   * 传输形态决定「线上的字节长什么样」。整条请求链（交换投影、修改器上下文）共用它。
   *
   * 它与上游跳无关：上游用哪种形态由那个端点的地址决定，客户端说要 WebSocket 也改变不了
   * 一个 `https://` 端点。`PlannerInput` 里根本没有传输字段，客户端偏好因此在类型上就没有到达上游侧的路（§2.3.1）。
   */
  readonly transport: TransportKind
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  /**
   * 会话亲和键：客户端自带的按会话稳定的请求 ID（六个标准头之一，见
   * `request-attribute-collector`），拿不到时为 `null`。
   *
   * 它是**客户端声明的事实**，代理不推导、不改写：调度用它把同一会话粘在
   * 最近一次成功的供应商模型上（缓存亲和，见 `upstream/affinity`），
   * 观测侧则原样落库为 `request.client_request_id` 属性。
   */
  readonly sessionKey: string | null
  readonly attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  readonly requestBody: Buffer
  readonly signal: AbortSignal
}

export type RequestContextInput = Omit<RequestContext, 'signal' | 'headers' | 'attributes' | 'transport' | 'sessionKey'> & {
  headers?: IncomingHttpHeaders
  attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  signal?: AbortSignal
  sessionKey?: string | null
  /** 省略即 `http`：不以形态为卖点的调用方（模型连通性探测、能力自检）都是一问一答形状的。 */
  transport?: TransportKind
}

export function createRequestContext(input: RequestContextInput): RequestContext {
  return {
    ...input,
    headers: input.headers ?? {},
    attributes: input.attributes ?? [],
    transport: input.transport ?? 'http',
    sessionKey: input.sessionKey ?? null,
    signal: input.signal ?? new AbortController().signal,
  }
}
