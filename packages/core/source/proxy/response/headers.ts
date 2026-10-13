import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { ProtocolAuthHeaders } from '@common/protocols'
import type { HeaderMap } from '@server/proxy/contracts/headers'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const CLIENT_AUTH_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
])

/**
 * 向上游协商正文压缩的头。
 *
 * 代理必须读懂上游回回来的正文：协议转换要按它的字段重排、正文改写要按它的结构改、
 * 失败归因要按它的话解释、日志要把它存下来。而这条链路上**没有**任何解压环节，
 * 所以一旦上游按 `gzip` 回，上面每一处拿到的都是二进制乱码——最坏的情况是日志里
 * 留下一段坏字符串、失败归因读出乱码、改写把压缩字节当 JSON 解析。
 *
 * 既然读得懂才算代理，就不要去要压缩：HTTP 规定 `identity` 永远合法，去掉这个头
 * 不会让上游拒收请求，客户端拿到的正文只会更直白。这是转发时**唯一**一个「既有理由、
 * 又不是被协议逼着」的例外，其余的头一律原样转发。
 */
const COMPRESSION_HEADERS = new Set([
  'accept-encoding',
])

/**
 * 与「这一跳连到哪里、发多少字节」绑定的头。
 *
 * 它们不是客户端的偏好，是**位置**的函数：上游不是同一个地址（客户端的 `host` 指的是我们），
 * 正文也可能被协议转换或改写规则换掉（客户端的 `content-length` 说的是它自己发的那一份）。
 * 所以这两个值必须由我们现算，转发客户端的原值只会把请求打到别人的虚拟主机上，或者让上游截断正文。
 */
const POSITION_HEADERS = new Set([
  'host',
  'content-length',
])

const SENSITIVE_HEADERS = new Set([
  ...CLIENT_AUTH_HEADERS,
  'proxy-authorization',
  'cookie',
  'set-cookie',
])

export function redactHeaders(source: IncomingHttpHeaders | OutgoingHttpHeaders, additionalSensitiveHeaders: string[] = []): Record<string, string | string[]> {
  const sensitiveHeaders = new Set([...SENSITIVE_HEADERS, ...additionalSensitiveHeaders.map(name => name.toLowerCase())])
  return Object.fromEntries(
    Object.entries(source)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([name, value]) => [name, sensitiveHeaders.has(name.toLowerCase()) ? '[REDACTED]' : value]),
  )
}

/**
 * 把 header 对象序列化为脱敏后的 JSON 字符串，用于正文记录的 header 列。
 *
 * 空对象（例如响应头尚未写出时的 `response.headers()`）归一化为 `null`，
 * 让「没有头信息」与「从没采集过」在存储层保持一致，避免写入无意义的 `'{}'`。
 */
export function serializeCapturedHeaders(headers: IncomingHttpHeaders | OutgoingHttpHeaders | null): string | null {
  if (!headers || Object.keys(headers).length === 0) return null
  return JSON.stringify(redactHeaders(headers))
}

/**
 * 客户端请求头 → 上游请求头。
 *
 * **默认转发**：客户端带了什么就照原样转发出去，连名字的大小写都不动。理由很实在——官方接口
 * 各有各的方言（`openai-beta`、`anthropic-beta`、`x-stainless-*`、`originator`、`session_id`、
 * `x-goog-*`、`x-app`……），代理不可能穷举，也不该去猜。多带一个对方不认识的头最多是无害的，
 * 少带一个却是 400。所以这里**不维护**「允许转发」的白名单，只维护下面这份有理由的例外清单：
 *
 * 1. {@link POSITION_HEADERS}：`host` / `content-length` 由位置和真实字节数决定，必须现算。
 * 2. {@link HOP_BY_HOP_HEADERS} 与 `connection` 里点名的头：HTTP/1.1 规定它们描述的是「这一段连接」
 *    而不是「这个请求」，转发等于让上游拿我们的连接状态去理解它自己的连接。
 * 3. 客户端的鉴权头：{@link CLIENT_AUTH_HEADERS} 与 `auth.replace` 的落点。那份密钥是客户端对
 *    **另一家**发的，转发出去既不生效，也把客户端的凭据交给了别人；供应商的凭据随后覆盖上去。
 * 4. {@link COMPRESSION_HEADERS}：本链路上没有解压环节（见上面的注释）。
 *
 * `auth.fill`（协议形态要求的头）**只补缺**：客户端已经带了同名头就用客户端的值，
 * 我们只是那个「没带时的兜底」。
 */
export function createUpstreamRequestHeaders(source: IncomingHttpHeaders, auth: ProtocolAuthHeaders, contentLength: number, extraHeaders?: Readonly<Record<string, string>>): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  const connectionHeaders = parseConnectionHeaders(source.connection)
  const replacedHeaders = new Set(Object.keys(auth.replace).map(name => name.toLowerCase()))
  const forwardedHeaders = new Set<string>()

  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toLowerCase()
    if (value === undefined) continue
    if (POSITION_HEADERS.has(normalizedName)) continue
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionHeaders.has(normalizedName)) continue
    if (COMPRESSION_HEADERS.has(normalizedName)) continue
    if (CLIENT_AUTH_HEADERS.has(normalizedName) || replacedHeaders.has(normalizedName)) continue
    headers[name] = value
    forwardedHeaders.add(normalizedName)
  }

  for (const [name, value] of Object.entries(auth.fill)) {
    if (forwardedHeaders.has(name.toLowerCase())) continue
    headers[name] = value
  }

  Object.assign(headers, auth.replace)
  // 插件（`resolveRequest`）附加的头排在鉴权之后：它是「再加一个头」，不是「换个密钥落在哪」
  // （换密钥落点走 `customAuthHeader`）。但位置类、逐跳类与鉴权头一律不让它碰——
  // 前两类由链路自己算，后一类是凭据，让插件绕过它等于把「密钥只由一个字段决定」这条规则废掉。
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      const normalizedName = name.toLowerCase()
      if (POSITION_HEADERS.has(normalizedName)) continue
      if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionHeaders.has(normalizedName)) continue
      if (replacedHeaders.has(normalizedName)) continue
      headers[name] = value
    }
  }
  if (contentLength > 0) headers['content-length'] = String(contentLength)
  return headers
}

export function createDownstreamHeaders(source: IncomingHttpHeaders): HeaderMap {
  const headers: HeaderMap = {}
  const connectionHeaders = parseConnectionHeaders(source.connection)

  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toLowerCase()
    if (value === undefined) continue
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionHeaders.has(normalizedName)) continue
    headers[name] = value
  }

  return headers
}

function parseConnectionHeaders(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean),
  )
}
