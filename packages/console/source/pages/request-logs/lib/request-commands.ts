/**
 * 把「采集到的一份报文」翻译成 `buildCurl` / `buildFetch` 的输入。
 *
 * 两个视角的取数规则完全不同，混在一起最容易出错：
 *
 * - **客户端视角**：记录里只存了路径，必须接上代理监听地址才是可执行的 URL；
 *   头与正文是客户端发来的原件。
 * - **上游视角**：地址是那次尝试自己记下的绝对 URL（协议转换与地址改写都在里面），
 *   拿代理地址再拼一遍会指回本地；头与正文是改写与转换之后的那一份。
 *
 * 因此这里不提供「一个函数带个开关」，而是两个各自说清来源的函数；
 * 缺件时返回 `null`，由界面决定是禁用还是隐藏，而不是拼出一条半截的请求。
 */

import type { AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import type { RequestCommandInput } from './request-command'
import { normalizeMethod } from './request-command'

/**
 * 客户端原始请求。
 *
 * `origin` 为 `null` 表示代理没在监听（或地址未知），此时路径拼不出可执行 URL，
 * 整条命令不成立。
 */
export function clientCommandInput(origin: string | null, content: RequestContent | null): RequestCommandInput | null {
  if (origin === null || content === null) return null
  return {
    url: `${origin}${content.requestPath}`,
    method: normalizeMethod(content.requestMethod),
    headers: content.requestHeaders,
    body: content.requestBody,
  }
}

/**
 * 真正发往供应商的那次请求。
 *
 * `attempt` 为 `null` 表示这次请求一次尝试都没有——没有任何东西发出去过。
 * 方法优先用客户端那次的方法：上游记录的报文里本身不带方法，而代理不会改动词，
 * 只在客户端报文也缺失时才退回落 `POST`（见 `normalizeMethod`）。
 */
export function upstreamCommandInput(attempt: RequestLogEntryAttempt | null, content: AttemptContent | null, clientMethod: string | null): RequestCommandInput | null {
  if (attempt === null || content === null) return null
  return {
    url: attempt.url,
    method: normalizeMethod(clientMethod ?? ''),
    headers: content.requestHeaders,
    body: content.requestBody,
  }
}
