export type UpstreamStatusDisposition = 'success' | 'failover' | 'terminal'
export type HealthFailureScope = 'provider' | 'provider-model' | 'none'

export interface HealthFailureInput {
  statusCode: number | null
  responseBody?: string | null
  /**
   * 上游 2xx 但没有兼现客户端跳要求的形态（要 `http-stream` 却回了非 SSE 的整包，或反之）。
   *
   * 这个事实必须**单独告知**：状态码在这一种失败里是没有用的——`200` 落在成功区间，
   * 按状态码分类只会得到 `'none'`，于是这个模型永远不会被冷却，下一次请求依旧会选中它（§1.2）。
   */
  transportMismatch?: boolean
  /**
   * 响应头已经到手、正文搬到一半却断了（上游 2xx 但没有把这份正文交完）。
   *
   * 与 `transportMismatch` 同样的道理：失败的事实不在状态码里，只说给调用方听。
   */
  streamInterrupted?: boolean
}

/** 状态码之外的失败事实；`recordHealthFailure` 用它把「这次失败长什么样」整份传下去。 */
export type HealthFailureHints = Omit<HealthFailureInput, 'statusCode'>

export function classifyUpstreamStatus(statusCode: number): UpstreamStatusDisposition {
  if (statusCode >= 200 && statusCode < 300) return 'success'
  // 上游状态码无法证明请求在其他供应商也一定无效，默认优先切换供应商：
  // `400`/`422` 最常见的来源是「这家不支持这个参数」，换一家就成立了，
  // 因此不能只因为「是 4xx」就把它当成请求本身的问题交给客户端。
  return 'failover'
}

/**
 * 上游明确在说「这个请求本身不成立」的状态码。
 *
 * 切换候选与「最终回什么给客户端」是两件事：这里回答的是后者。全部候选都试过以后，
 * 如果其中有上游回的是这一组状态码，那客户端手里的请求就是不可能成功的，
 * 此时把 `502 ALL_PROVIDERS_FAILED` 交给它会诱导它在同一个请求上反复重试
 * （`502` 在客户端语义里是「网关临时故障，可重试」），真正的根因被永久隐藏。
 *
 * 白名单必须显式枚举，不能用「4xx」一把抓：
 *
 * - `401` / `403`：凭证问题，换一家可能就成功了，不属于「请求本身的问题」；
 * - `404`：模型或路径不存在，同样是换一家可能成立；
 * - `408`：上游自己等待超时，是上游侧的事实；
 * - `429`：限流，换一家可能成立，且客户端重试也确实是对的。
 *
 * `400` / `413` / `414` / `422` 是仅有的「报文格式不成立」类：换多少家都一样。
 */
const CLIENT_ATTRIBUTABLE_STATUS_CODES: ReadonlySet<number> = new Set([400, 413, 414, 422])

/** 全部候选告罄时，上游是否明确告诉过我们「这个请求本身不成立」。 */
export function isClientAttributableStatus(statusCode: number): boolean {
  return CLIENT_ATTRIBUTABLE_STATUS_CODES.has(statusCode)
}

export function classifyHealthFailure(input: HealthFailureInput): HealthFailureScope {
  const { statusCode, responseBody, transportMismatch, streamInterrupted } = input
  // 「没兼现要求」与「正文没搬完」都是**这个模型**没做到：同样的请求在别的候选上可能就能做到，
  // 因此冷却的粒度是 provider-model，而不是整个 provider。
  if (transportMismatch) return 'provider-model'
  if (streamInterrupted) return 'provider-model'
  if (statusCode === null) return 'provider'
  if (statusCode === 401 || statusCode === 403) return 'provider'
  if (statusCode === 429) {
    const normalizedBody = responseBody?.toLowerCase() ?? ''
    const providerLimited = /(?:account|organization|project|provider|api[ _-]?key).*(?:quota|rate[ _-]?limit)|(?:quota|rate[ _-]?limit).*(?:account|organization|project|provider|api[ _-]?key)/.test(normalizedBody)
    return providerLimited ? 'provider' : 'provider-model'
  }
  if (statusCode === 404 || statusCode === 408 || statusCode >= 500) return 'provider-model'
  return 'none'
}
