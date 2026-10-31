import type { HeaderMap } from '@server/proxy/contracts'

/**
 * 一个可能装着上游请求标识的头。
 *
 * `header` 必须**全小写**：Node 把上游回来的头名一律折成小写，写 `X-Request-Id` 永远匹配不到。
 * 少数头里装的不是标识本身而是一整串别的信息（W3C `traceparent`、Route 53 的
 * `x-amzn-trace-id`），由 `parse` 再剖一刀；它返回 `null` 表示这个头里没有可用的标识，
 * 继续往下一个头找。
 */
interface UpstreamRequestIdSource {
  readonly header: string
  readonly parse?: (value: string) => string | null
}

/**
 * `traceparent: 00-<32 位 trace-id>-<16 位 span-id>-01` —— 取中间那段 trace-id。
 *
 * 不返回整串：整串带版本号、span 与采样标记，各段之间用 `-` 连，粘进搜索框里没人能对上。
 * trace-id 才是「这一次请求」在所有服务之间共享的那个值。
 */
function parseTraceparent(value: string): string | null {
  const segments = value.split('-')
  return segments.length >= 4 ? segments[1] ?? null : null
}

/** `x-amzn-trace-id: Root=1-6789-abc;Parent=5399;Sampled=1` —— 取 `Root`，它才是整条链的标识。 */
function parseAmznTraceId(value: string): string | null {
  for (const part of value.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim().toLowerCase() !== 'root') continue
    const root = part.slice(separator + 1).trim()
    if (root) return root
  }
  return null
}

/** `x-cloud-trace-context: <trace-id>/<span-id>;o=1` —— 取斜杠前那段。 */
function parseCloudTraceContext(value: string): string | null {
  return value.split('/')[0] ?? null
}

/**
 * 上游请求标识可能出现的位置，**按可信度从高到低排**：先找供应商亲口发的一等标识，
 * 再找网关与边车塞进来的，最后才退到分布式追踪——追踪值是「这一次调用链」的标识，
 * 不是「这一次上游请求」的标识，拿它去问对方只能问到个大概。
 *
 * 顺序本身就是规则：**首个非空命中即返回**。所以新加一个头时想清楚它该排在哪一档，
 * 排在前面会让后面那些更准的头失去机会。
 */
export const UPSTREAM_REQUEST_ID_SOURCES: readonly UpstreamRequestIdSource[] = [
  // —— 供应商自己发的一等标识 ——
  { header: 'anthropic-request-id' },
  { header: 'request-id' },
  { header: 'x-request-id' },
  { header: 'x-ms-request-id' },
  { header: 'apim-request-id' },
  { header: 'x-ms-client-request-id' },
  { header: 'x-goog-request-id' },
  { header: 'x-amzn-requestid' },
  { header: 'x-amzn-request-id' },
  /** 火山引擎 / 方舟：报错页与工单里给的 `LogID` 就是它。 */
  { header: 'x-tt-logid' },
  /** 百度智能云 BCE 系。 */
  { header: 'x-bce-request-id' },
  /** 阿里云 DashScope 系。 */
  { header: 'x-dashscope-request-id' },
  { header: 'x-req-id' },
  // —— 网关、边车、CDN 塞进来的 ——
  { header: 'x-amz-apigw-id' },
  { header: 'x-amz-cf-id' },
  { header: 'cf-ray' },
  { header: 'x-correlation-id' },
  { header: 'x-request-guid' },
  { header: 'x-trace-id' },
  { header: 'x-b3-traceid' },
  { header: 'x-vllm-request-id' },
  // —— 分布式追踪：要再剖一刀 ——
  { header: 'x-amzn-trace-id', parse: parseAmznTraceId },
  { header: 'traceparent', parse: parseTraceparent },
  { header: 'x-cloud-trace-context', parse: parseCloudTraceContext },
]

/**
 * 按名字取一个头，**大小写不敏感**。
 *
 * 正常路径是直接命中（上游回来的头本来就是小写），查不到才扫一遍键名——少数传输
 * （例如自己拼出来的握手响应、测试里手写的报文）不会帮我们折小写。
 */
function readHeader(headers: HeaderMap, name: string): string | null {
  const direct = headers[name]
  if (direct !== undefined && !Array.isArray(direct)) return direct
  // 重复头在 Node 里是数组，取第一个就够了。
  if (Array.isArray(direct)) return direct[0] ?? null
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name)
  if (key === undefined) return null
  const value = headers[key]
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

/**
 * 上游自己的请求 id。
 *
 * 各家放在不同的头里，因此按 `UPSTREAM_REQUEST_ID_SOURCES` 的顺序依次找；找不到就是找不到，
 * 不用本地 id 顶替——上游请求 id 的唯一用途是「拿它去问上游」，编一个出来只会误导排查。
 *
 * 有一类情况要留意：部分供应商会把我们发过去的 `x-request-id` 原样回显。那串值虽然不是
 * 上游自己生成的，仍然是这次调用的关联键（对方的访问日志里记着同一个），所以照常采用。
 */
export function extractUpstreamRequestId(headers: HeaderMap): string | null {
  for (const source of UPSTREAM_REQUEST_ID_SOURCES) {
    const raw = readHeader(headers, source.header)
    if (raw === null) continue
    const value = source.parse === undefined ? raw : source.parse(raw)
    const candidate = value?.trim() ?? ''
    if (candidate) return candidate
  }
  return null
}

export function extractRequestIdFromBody(body: string | null): string | null {
  if (!body) return null

  // 普通 JSON 响应：兼容成功响应、错误响应以及 Provider 自己的嵌套结构。
  const directId = parseRequestIdJson(body)
  if (directId) return directId

  // 流式响应的捕获内容是 { schemaVersion, chunks }，每个 chunk 可能包含多个 SSE event。
  try {
    const captured = JSON.parse(body) as Record<string, unknown>
    if (Array.isArray(captured.chunks)) {
      for (const chunk of captured.chunks) {
        if (typeof chunk !== 'string') continue
        const id = extractRequestIdFromSse(chunk)
        if (id) return id
      }
    }
  } catch {
    // 非 JSON body 可能仍然是原生 SSE 文本，继续按 SSE 解析。
  }

  return extractRequestIdFromSse(body)
}

function parseRequestIdJson(body: string): string | null {
  try {
    return findRequestId(JSON.parse(body))
  } catch {
    return null
  }
}

export function extractRequestIdFromSse(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const data = line.trim().replace(/^data:\s*/, '')
    if (!data || data === '[DONE]') continue
    const id = parseRequestIdJson(data)
    if (id) return id
  }
  return null
}

function findRequestId(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findRequestId(item, depth + 1)
      if (id) return id
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of ['request_id', 'requestId', 'id']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const child of Object.values(record)) {
    const id = findRequestId(child, depth + 1)
    if (id) return id
  }
  return null
}
