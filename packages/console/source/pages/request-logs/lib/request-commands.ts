/**
 * 把「采集到的一份报文」翻译成 `buildCurl` / `buildFetch` 的输入。
 *
 * 这里只处理**上游视角**：供应商看到的报文就是那次尝试的报文。地址取尝试自己记下的
 * 绝对 URL（协议转换与地址改写的结果都在里面），头与正文取 `attempt_contents`——
 * 改写与转换之后的那一份。
 *
 * 客户端发来的原件不在这里：它记的只有路径，要靠代理监听地址才拼得成 URL，
 * 而那份报文在行上已经有自己的复制入口。两档并列只会把「复制请求」变成
 * 「复制哪一份请求」，而对着一次具体尝试，这个问题本就不该存在。
 */

import type { AttemptContent, RequestLogEntryAttempt } from '@common/schemas'
import type { RequestCommandInput } from './request-command'
import { normalizeMethod } from './request-command'

/**
 * 真正发给供应商的那次请求。
 *
 * `attempt` 为 `null` 表示这次请求一次尝试都没有——没有任何东西发出去过；
 * `content` 为 `null` 表示这次尝试的报文没采到（或已被保留策略清理）；
 * `attempt.url` 为空表示连地址都没记下来。三种情况都让整条命令不成立，
 * 由界面决定禁用，而不是拼出一条地址是空串的半截命令。
 *
 * 方法优先用客户端那次的方法：上游记录的报文里本身不带方法，而代理不会改动词，
 * 只在客户端报文也缺失时才退回落 `POST`（见 `normalizeMethod`）。
 */
export function upstreamCommandInput(attempt: RequestLogEntryAttempt | null, content: AttemptContent | null, clientMethod: string | null): RequestCommandInput | null {
  if (attempt === null || content === null || attempt.url === '') return null
  return {
    url: attempt.url,
    method: normalizeMethod(clientMethod ?? ''),
    headers: content.requestHeaders,
    body: content.requestBody,
  }
}
