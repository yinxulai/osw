import type http from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AttemptStatus, Protocol, RawUsage, RequestAttribute, RequestStatus } from '@common/schemas'
import type { ClientDelivery, TransportKind, UpstreamTarget } from '@server/proxy/contracts'

export interface RequestLogContext {
  /** 解析出的逻辑模型；`null` 表示尚未（或未能）解析出逻辑模型。 */
  logicalModelId: string | null
  /** 客户端请求协议；`null` 表示连 API 路径都无法识别。 */
  clientProtocol: Protocol | null
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  requestBody: Buffer
  /**
   * 客户端跳的传输形态（**预期**）。入口按接口的封装描述解析一次后原样落库。
   *
   * 保留轴上的取值而不是提前压成 `boolean`：`request_logs.transport` 是一列取值，
   * 而「上游跳是不是同一个形态」是另一回事（落在尝试行的 `upstreamTransport`）。
   */
  transport: TransportKind
}

export interface RequestLoggingInput extends RequestLogContext {
  requestId: string
  /** 是否记录请求日志。关掉时整条日志链路（请求行、尝试行、用量、正文）都不落库。 */
  captureRequestLogs: boolean
  captureRequestContent: boolean
}

/**
 * 客户端视角的最终响应结果，写入 `request_contents` 的响应侧。
 *
 * 这里的每个字段都必须是「客户端真正收到的东西」：如果响应从未写出客户端，
 * 对应字段就应为 `null`，而不是用上游的值顶替。
 */
export interface RequestContentOutcome {
  /**
   * 视角标记。
   *
   * `AttemptOutcome` 与 `RequestContentOutcome` 的字段结构高度相似，若不加标记，
   * 误把上游视角数据直接写入客户端正文时编译器不会报错。这个字面量只能由
   * 「尝试结果 -> 客户端视角」的显式转换函数产生，从类型上杜绝该类混淆。
   */
  perspective: 'client'
  captureStatus?: 'captured' | 'partial'
  /** 最终返回给客户端的 HTTP 状态码；未写出时为 `null`。 */
  statusCode: number | null
  /** 最终返回给客户端的响应头（脱敏后的 JSON 字符串）；未写出时为 `null`。 */
  responseHeaders?: string | null
  /** 最终返回给客户端的响应体。 */
  responseBody?: string | null
}

/**
 * 一次尝试要记录的上游事实。
 *
 * 这是从规划器的 {@link UpstreamTarget} 投影出来的窄视图：观测层只声明它真正要落库的字段，
 * 不去拿整个目标对象（否则每加一个字段都会自动进入写入路径）。
 */
export interface AttemptLogSnapshot {
  providerId: string
  providerModelId: string
  providerName: string
  providerModelName: string
  upstreamProtocol: Protocol
  url: string
}

export interface AttemptUsageInput {
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  rawUsage?: RawUsage | null
}

/**
 * 上游视角的响应内容，写入 `attempt_contents`。
 *
 * 这里的每个字段都必须是「上游真正返回的东西」，与客户端收到的内容无关。
 * 连接失败、超时这类本地错误下上游一个字节都没回：状态码与响应头保持 `null`，
 * 响应体只写本地观察到的失败原因（带 `localFailure` 标记），绝不凭空造一个状态码。
 */
export interface UpstreamContentInput {
  captureStatus: 'captured' | 'partial'
  /** 上游返回的 HTTP 状态码；上游没有返回任何响应时为 `null`。 */
  responseStatus: number | null
  /** 上游返回的响应头，来源固定为 upstream 响应；上游没有返回任何响应时为 `null`。 */
  responseHeaders: IncomingHttpHeaders | null
  /**
   * 上游返回的响应体。
   *
   * 上游没有返回任何响应时，这里写的是本地失败原因（JSON，含 `localFailure` 标记），
   * 而不是上游内容——否则一次连接失败在记录里只剩一个空壳，看不出为什么失败。
   */
  responseBody: string | null
}

export interface AttemptLoggingInput {
  requestId: string
  attemptIndex: number
  startedAt: number
  /** 这次尝试真正连到的上游；落库用的上游事实全部从它投影。 */
  target: UpstreamTarget
  /** 实际发往上游的请求头（已完成改写与协议转换）。 */
  upstreamRequestHeaders: http.OutgoingHttpHeaders
  /** 实际发往上游的请求体（已完成改写与协议转换）。 */
  upstreamRequestBody: Buffer
  /** 本次尝试在请求阶段命中的改写规则 id。 */
  requestRewriteRuleIds?: string[]
  customAuthHeader?: string | null
  captureRequestContent: boolean
}

/**
 * 一次性完成「尝试记录 + 正文捕获」的入参。
 * 供 attempt 执行器在收到上游响应（或失败）后统一落库使用。
 *
 * 「形态」在两个视角上是两件不同的事，因此分居两张表：
 * - 客户端跳的传输形态：请求级**预期**，写在 `request_logs.transport`；
 * - 上游跳实际是什么形态：尝试级**事实**，写到这里的 {@link upstreamTransport}。
 */
export interface AttemptFinalizationInput {
  status: AttemptStatus
  httpStatus: number | null
  retryable: boolean
  /**
   * 上游跳实际是什么形态。
   *
   * 未收到响应（网络错误、请求取消）时无从判断，因此为 `null`——不假称「是 http」。
   */
  upstreamTransport: TransportKind | null
  /**
   * 这次尝试是否就是「服务该请求」的那次尝试。
   *
   * 为真时它的用量会镜像成请求级用量：请求级用量没有独立的写入点。
   */
  servesRequest: boolean
  errorCode?: string
  errorMessage?: string
  upstreamRequestId?: string | null
  /** 本次尝试从发出请求到上游首个输出的耗时；未产生输出时留空。 */
  ttftMilliseconds?: number | null
  usage?: AttemptUsageInput
  /** 上游视角的响应内容；为空表示本次不写入。 */
  upstreamContent?: UpstreamContentInput | null
  /** 本次尝试在响应阶段命中的改写规则 id。 */
  responseRewriteRuleIds?: string[]
}

export interface RequestLogger {
  readonly requestContentId: string | null
  /**
   * 请求身份或路由事实更新后同步请求行。
   *
   * 入口可以在正文读取、路由求解前先建立请求行，因此日志器必须允许后续补齐协议、逻辑模型、
   * 形态与客户端正文，而不是等到执行阶段才决定“这次请求有没有日志”。
   */
  updateRequest(context: RequestLogContext): Promise<void>
  /**
   * 收尾请求日志：只落状态与总耗时。用量不在其中——它属于「服务该请求的那次尝试」。
   *
   * 同一实例重复调用只生效第一次：取消竞态下两条路径会先后调用它。
   */
  finalizeRequestLog(status: RequestStatus, startedAt: number): Promise<void>
  finalizeRequestContent(outcome: RequestContentOutcome): Promise<void>
  /**
   * 记录一条由代理自己生成的错误响应。
   *
   * 入参就是 {@link ClientDelivery}：这条响应同样是「客户端收到的东西」，它的状态码、
   * 响应头与正文必须来自出口的同一份快照。代理生成与转发自上游的响应在这里没有区别，
   * 因此不该有一条只给前者用的旁路。
   */
  finalizeLocalErrorContent(delivered: ClientDelivery): Promise<void>
}

/** attempt 级日志器：一次性写入这次尝试的全部事实与上游视角正文。 */
export interface AttemptLogger {
  finalizeAttempt(input: AttemptFinalizationInput): Promise<void>
}
